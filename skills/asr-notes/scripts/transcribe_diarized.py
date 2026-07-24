#!/usr/bin/env python3
"""Run high-accuracy local Qwen3-ASR and preserve speaker-attributed output."""

from __future__ import annotations

import argparse
from difflib import SequenceMatcher
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
from typing import Any
import unicodedata


DEFAULT_MODEL = "Qwen/Qwen3-ASR-1.7B"
DEFAULT_DTYPE = "bfloat16"
DEFAULT_ALIGNER = "Qwen/Qwen3-ForcedAligner-0.6B"
DEFAULT_PYANNOTE_MODEL = "pyannote/speaker-diarization-community-1"
SPEAKER_LABEL = re.compile(r"^SPEAKER_[0-9]+$")


def _format_timestamp(seconds: float) -> str:
    millis = max(0, round(float(seconds) * 1000))
    hours, remainder = divmod(millis, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    secs, millis = divmod(remainder, 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d}.{millis:03d}"


def _resolve_cli(explicit: str | None) -> str:
    candidates = [
        explicit,
        os.environ.get("DOMI_ASR_CLI"),
        str(Path.home() / ".local/share/domi/asr-venv/bin/mlx-qwen3-asr"),
        shutil.which("mlx-qwen3-asr"),
    ]
    for candidate in candidates:
        if not candidate:
            continue
        path = Path(candidate).expanduser()
        if path.is_file() and os.access(path, os.X_OK):
            return str(path.resolve())
    raise RuntimeError(
        "mlx-qwen3-asr executable not found. Install the domi ASR runtime or set "
        "DOMI_ASR_CLI to its absolute path."
    )


def _has_diarization_access(env: dict[str, str]) -> bool:
    """Check access without copying a cached Hugging Face token into child env."""
    model_id = env.get("PYANNOTE_MODEL_ID", DEFAULT_PYANNOTE_MODEL)
    if Path(model_id).expanduser().exists():
        return True
    if any(
        env.get(name)
        for name in (
            "PYANNOTE_AUTH_TOKEN",
            "HF_TOKEN",
            "HUGGINGFACE_TOKEN",
            "HUGGING_FACE_HUB_TOKEN",
        )
    ):
        return True
    if env.get("HF_HUB_DISABLE_IMPLICIT_TOKEN", "").lower() in {"1", "true", "yes"}:
        return False
    try:
        from huggingface_hub import get_token
    except ImportError:
        return False
    token = get_token()
    has_token = bool(token)
    del token
    return has_token


def _as_time(value: Any, field: str) -> float:
    if isinstance(value, bool):
        raise ValueError(f"{field} must be a number")
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{field} must be a number") from exc
    if not math.isfinite(number):
        raise ValueError(f"{field} has a non-finite timestamp")
    return number


def _canonical_text(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value).casefold()
    return "".join(
        char
        for char in normalized
        if unicodedata.category(char)[0] not in {"C", "P", "Z"}
    )


def _require_text_coverage(source: str, candidate: str, label: str) -> None:
    expected = _canonical_text(source)
    actual = _canonical_text(candidate)
    if not expected or not actual:
        raise ValueError(f"{label} does not cover the transcript text")
    if expected == actual:
        return
    length_ratio = len(actual) / len(expected)
    similarity = SequenceMatcher(None, expected, actual, autojunk=True).ratio()
    if not 0.85 <= length_ratio <= 1.15 or similarity < 0.90:
        raise ValueError(
            f"{label} only partially covers the transcript "
            f"(length ratio {length_ratio:.2f}, similarity {similarity:.2f})"
        )


def _atomic_write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=path.parent,
            prefix=f".{path.name}.",
            suffix=".tmp",
            delete=False,
        ) as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
            temporary = Path(handle.name)
        os.replace(temporary, path)
    finally:
        if temporary is not None and temporary.exists():
            temporary.unlink()


def _stamp_provenance(json_path: Path) -> None:
    with json_path.open("r", encoding="utf-8") as handle:
        data = json.load(handle)
    if not isinstance(data, dict):
        raise ValueError("ASR JSON root must be an object")
    data["domi_provenance"] = {
        "model": DEFAULT_MODEL,
        "dtype": DEFAULT_DTYPE,
        "forced_aligner": DEFAULT_ALIGNER,
        "timestamps": True,
        "diarization": True,
    }
    _atomic_write_text(
        json_path, json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    )


def _preflight_runtime(asr_cli: str, env: dict[str, str]) -> None:
    if not _has_diarization_access(env):
        raise RuntimeError(
            "speaker diarization requires one-time Hugging Face access: accept "
            f"the terms for {DEFAULT_PYANNOTE_MODEL}, then run `hf auth login` "
            "locally; the token must not be pasted into the skill or command line"
        )

    completed = subprocess.run(
        [asr_cli, "--doctor"],
        check=False,
        capture_output=True,
        text=True,
        env=env,
    )
    report = "\n".join(part.strip() for part in (completed.stdout, completed.stderr) if part)
    required_checks = (
        "[OK] mlx: installed",
        "[OK] diarize extras: pyannote.audio + torch + torchcodec installed",
    )
    missing = [check for check in required_checks if check not in report]
    if completed.returncode != 0 or missing:
        detail = "; ".join(missing) if missing else f"doctor exit {completed.returncode}"
        raise RuntimeError(
            "local ASR runtime preflight failed: "
            f"{detail}. Run `{asr_cli} --doctor` for installation details"
        )


def _validate_timestamp_segments(
    segments: Any, transcript_text: str
) -> tuple[list[dict[str, Any]], set[str]]:
    if not isinstance(segments, list) or not segments:
        raise ValueError("ASR JSON is missing timestamp segments")
    previous_start = -1.0
    segment_texts: list[str] = []
    labeled_segments: list[dict[str, Any]] = []
    speakers: set[str] = set()
    for index, item in enumerate(segments):
        if not isinstance(item, dict):
            raise ValueError(f"segments[{index}] is not an object")
        missing = {"start", "end", "text", "speaker"} - item.keys()
        if missing:
            raise ValueError(f"segments[{index}] is missing: {', '.join(sorted(missing))}")
        if not isinstance(item["text"], str):
            raise ValueError(f"segments[{index}].text must be a string")
        if not isinstance(item["speaker"], str):
            raise ValueError(f"segments[{index}].speaker must be a string")
        start = _as_time(item["start"], f"segments[{index}].start")
        end = _as_time(item["end"], f"segments[{index}].end")
        speaker = item["speaker"].strip()
        text = item["text"]
        if not SPEAKER_LABEL.fullmatch(speaker):
            raise ValueError(
                f"segments[{index}] has an unsafe speaker label: {speaker!r}"
            )
        if start < 0 or end < start:
            raise ValueError(f"segments[{index}] has an invalid time range")
        if start < previous_start:
            raise ValueError("timestamp segments are not sorted by start time")
        previous_start = start
        segment_texts.append(text)
        if text:
            speakers.add(speaker)
            labeled_segments.append(
                {"speaker": speaker, "start": start, "end": end, "text": text}
            )
    _require_text_coverage(transcript_text, "".join(segment_texts), "timestamp segments")
    if not labeled_segments:
        raise ValueError("all timestamp segments are empty")
    return labeled_segments, speakers


def _source_text_pieces(
    transcript_text: str, segments: list[dict[str, Any]]
) -> list[str] | None:
    """Partition the punctuated transcript across aligned timestamp segments.

    ForcedAligner usually emits one segment per word or CJK character and omits
    punctuation from those segments.  When its canonical text exactly matches
    the top-level transcript, attach the original punctuation and spacing to
    the aligned items so the rendered speaker transcript remains lossless.
    """
    canonical_parts = [_canonical_text(item["text"]) for item in segments]
    if "".join(canonical_parts) != _canonical_text(transcript_text):
        return None

    pieces = ["" for _ in segments]
    cursor = 0
    for index, canonical_part in enumerate(canonical_parts):
        if not canonical_part:
            continue
        needed = len(canonical_part)
        consumed = 0
        piece: list[str] = []
        while cursor < len(transcript_text) and consumed < needed:
            char = transcript_text[cursor]
            piece.append(char)
            cursor += 1
            consumed += len(_canonical_text(char))
        if consumed != needed:
            return None
        while cursor < len(transcript_text) and not _canonical_text(
            transcript_text[cursor]
        ):
            piece.append(transcript_text[cursor])
            cursor += 1
        pieces[index] = "".join(piece)

    if cursor != len(transcript_text):
        return None
    return pieces


def _join_aligned_text(previous: str, current: str) -> str:
    if not previous:
        return current
    if not current:
        return previous
    if (
        previous[-1].isascii()
        and previous[-1].isalnum()
        and current[0].isascii()
        and current[0].isalnum()
    ):
        return f"{previous} {current}"
    return previous + current


def _render_turns_from_timestamp_segments(
    transcript_text: str, segments: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    source_pieces = _source_text_pieces(transcript_text, segments)
    turns: list[dict[str, Any]] = []
    for index, item in enumerate(segments):
        piece = (
            source_pieces[index]
            if source_pieces is not None
            else item["text"].strip()
        )
        if turns and turns[-1]["speaker"] == item["speaker"]:
            turns[-1]["end"] = max(turns[-1]["end"], item["end"])
            turns[-1]["text"] = (
                turns[-1]["text"] + piece
                if source_pieces is not None
                else _join_aligned_text(turns[-1]["text"], piece)
            )
            continue
        turns.append(
            {
                "speaker": item["speaker"],
                "start": item["start"],
                "end": item["end"],
                "text": piece,
            }
        )

    nonempty_turns = [item for item in turns if item["text"].strip()]
    if not nonempty_turns:
        raise ValueError("all rendered speaker turns are empty")
    _require_text_coverage(
        transcript_text,
        "".join(item["text"] for item in nonempty_turns),
        "rendered speaker turns",
    )
    return nonempty_turns


def _validated_segments(
    data: dict[str, Any], expected_speakers: int | None
) -> tuple[list[dict[str, Any]], list[str]]:
    transcript_text = data.get("text")
    if not isinstance(transcript_text, str) or not transcript_text.strip():
        raise ValueError("ASR JSON has an empty transcript")

    timestamp_segments, timestamp_speakers = _validate_timestamp_segments(
        data.get("segments"), transcript_text
    )

    if data.get("truncated") is True:
        raise ValueError("ASR JSON reports a truncated transcript")
    finish_reason = data.get("finish_reason")
    if isinstance(finish_reason, str):
        normalized_reason = finish_reason.casefold().replace("-", "_")
        if "length" in normalized_reason or "max_token" in normalized_reason:
            raise ValueError(f"ASR JSON reports incomplete generation: {finish_reason}")

    speaker_segments = data.get("speaker_segments")
    if not isinstance(speaker_segments, list) or not speaker_segments:
        raise ValueError("ASR JSON is missing speaker_segments")

    previous_start = -1.0
    speakers: set[str] = set()
    nonempty_segments: list[dict[str, Any]] = []
    for index, item in enumerate(speaker_segments):
        if not isinstance(item, dict):
            raise ValueError(f"speaker_segments[{index}] is not an object")
        missing = {"speaker", "start", "end", "text"} - item.keys()
        if missing:
            raise ValueError(
                f"speaker_segments[{index}] is missing: {', '.join(sorted(missing))}"
            )

        if not isinstance(item["speaker"], str):
            raise ValueError(f"speaker_segments[{index}].speaker must be a string")
        if not isinstance(item["text"], str):
            raise ValueError(f"speaker_segments[{index}].text must be a string")
        speaker = item["speaker"].strip()
        start = _as_time(item["start"], f"speaker_segments[{index}].start")
        end = _as_time(item["end"], f"speaker_segments[{index}].end")
        text = re.sub(r"\s+", " ", item["text"]).strip()
        if not SPEAKER_LABEL.fullmatch(speaker):
            raise ValueError(
                f"speaker_segments[{index}] has an unsafe speaker label: {speaker!r}"
            )
        if start < 0 or end < start:
            raise ValueError(f"speaker_segments[{index}] has an invalid time range")
        if start < previous_start:
            raise ValueError("speaker_segments are not sorted by start time")
        previous_start = start

        if text:
            speakers.add(speaker)
            nonempty_segments.append(
                {"speaker": speaker, "start": start, "end": end, "text": text}
            )

    if not nonempty_segments:
        raise ValueError("all speaker-attributed turns are empty")
    _require_text_coverage(
        transcript_text,
        "".join(item["text"] for item in nonempty_segments),
        "speaker segments",
    )
    if timestamp_speakers != speakers:
        raise ValueError(
            "speaker labels disagree between timestamp and diarization segments: "
            f"timestamps={', '.join(sorted(timestamp_speakers))}; "
            f"diarization={', '.join(sorted(speakers))}"
        )
    if expected_speakers is not None and len(speakers) != expected_speakers:
        raise ValueError(
            "speaker count mismatch: "
            f"expected {expected_speakers}, diarization produced {len(speakers)} "
            f"({', '.join(sorted(speakers))})"
        )
    rendered_turns = _render_turns_from_timestamp_segments(
        transcript_text, timestamp_segments
    )
    return rendered_turns, sorted(speakers)


def validate_and_render(
    json_path: Path,
    transcript_path: Path,
    expected_speakers: int | None,
) -> dict[str, Any]:
    if json_path.resolve() == transcript_path.resolve():
        raise ValueError("transcript output must not overwrite the authoritative JSON")
    with json_path.open("r", encoding="utf-8") as handle:
        data = json.load(handle)
    if not isinstance(data, dict):
        raise ValueError("ASR JSON root must be an object")

    segments, speakers = _validated_segments(data, expected_speakers)
    lines: list[str] = []
    for item in segments:
        lines.append(
            f"### {_format_timestamp(item['start'])} {item['speaker']}"
        )
        lines.append(item["text"])
        lines.append("")

    _atomic_write_text(transcript_path, "\n".join(lines).rstrip() + "\n")
    provenance = data.get("domi_provenance")
    verified_model = (
        provenance.get("model")
        if isinstance(provenance, dict) and provenance.get("model") == DEFAULT_MODEL
        else "unverified"
    )
    return {
        "json_path": str(json_path.resolve()),
        "transcript_path": str(transcript_path.resolve()),
        "speaker_count": len(speakers),
        "speakers": speakers,
        "segment_count": len(segments),
        "model": verified_model,
        "diarization_status": (
            "verified_count"
            if expected_speakers is not None
            else "needs_review"
            if len(speakers) == 1
            else "auto_detected"
        ),
    }


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Transcribe audio with Qwen3-ASR-1.7B, timestamps, and mandatory "
            "speaker diarization; then render a speaker-labelled transcript."
        )
    )
    inputs = parser.add_mutually_exclusive_group(required=True)
    inputs.add_argument("--audio", type=Path, help="Audio file to transcribe")
    inputs.add_argument(
        "--validate-json",
        type=Path,
        help="Validate and render an existing mlx-qwen3-asr JSON file",
    )
    parser.add_argument("--output-dir", type=Path)
    parser.add_argument("--transcript-output", type=Path)
    parser.add_argument("--context", default="")
    parser.add_argument("--num-speakers", type=int)
    parser.add_argument("--asr-cli")
    parser.add_argument("--model", default=DEFAULT_MODEL)
    return parser


def main() -> int:
    args = _build_parser().parse_args()
    if args.num_speakers is not None and args.num_speakers < 1:
        raise ValueError("--num-speakers must be at least 1")
    if args.model != DEFAULT_MODEL:
        raise ValueError(
            f"accuracy-first mode requires {DEFAULT_MODEL}; refusing model {args.model}"
        )

    if args.validate_json:
        json_path = args.validate_json.expanduser().resolve()
        output_dir = (args.output_dir or json_path.parent).expanduser().resolve()
        stem = json_path.stem
        transcript_path = (
            args.transcript_output.expanduser().resolve()
            if args.transcript_output
            else output_dir / f"{stem}.diarized.txt"
        )
        summary = validate_and_render(json_path, transcript_path, args.num_speakers)
    else:
        audio_path = args.audio.expanduser().resolve()
        if not audio_path.is_file():
            raise FileNotFoundError(f"audio file not found: {audio_path}")
        output_dir = (args.output_dir or audio_path.parent).expanduser().resolve()
        output_dir.mkdir(parents=True, exist_ok=True)
        json_path = output_dir / f"{audio_path.stem}.json"
        stem = audio_path.stem
        transcript_path = (
            args.transcript_output.expanduser().resolve()
            if args.transcript_output
            else output_dir / f"{stem}.diarized.txt"
        )
        protected_paths = {audio_path, json_path.resolve(), transcript_path.resolve()}
        if len(protected_paths) != 3:
            raise ValueError("audio, JSON, and transcript paths must be distinct")

        asr_cli = _resolve_cli(args.asr_cli)
        runtime_env = os.environ.copy()
        _preflight_runtime(asr_cli, runtime_env)
        with tempfile.TemporaryDirectory(
            dir=output_dir, prefix=f".{audio_path.stem}.asr-"
        ) as temporary_directory:
            run_dir = Path(temporary_directory)
            run_json_path = run_dir / f"{audio_path.stem}.json"
            command = [
                asr_cli,
                str(audio_path),
                "--model",
                DEFAULT_MODEL,
                "--dtype",
                DEFAULT_DTYPE,
                "--output-dir",
                str(run_dir),
                "--output-format",
                "json",
                "--timestamps",
                "--forced-aligner",
                DEFAULT_ALIGNER,
                "--diarize",
                "--quiet",
            ]
            if args.num_speakers is not None:
                command.extend(["--num-speakers", str(args.num_speakers)])
            if args.context.strip():
                command.extend(["--context", args.context.strip()])

            completed = subprocess.run(command, check=False, env=runtime_env)
            if completed.returncode != 0:
                raise RuntimeError(
                    "high-accuracy diarized transcription failed; no non-diarized or "
                    "0.6B fallback was attempted"
                )
            if not run_json_path.is_file():
                raise FileNotFoundError(
                    f"expected ASR JSON was not created: {run_json_path}"
                )
            _stamp_provenance(run_json_path)
            summary = validate_and_render(
                run_json_path, transcript_path, args.num_speakers
            )
            os.replace(run_json_path, json_path)
            summary["json_path"] = str(json_path.resolve())

    print(json.dumps(summary, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (FileNotFoundError, RuntimeError, ValueError, json.JSONDecodeError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        raise SystemExit(1)
