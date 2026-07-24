from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock


SCRIPT = Path(__file__).parents[1] / "scripts" / "transcribe_diarized.py"
SPEC = importlib.util.spec_from_file_location("transcribe_diarized", SCRIPT)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def _payload() -> dict:
    return {
        "text": "你好。你好，很高兴见到你。",
        "language": "Chinese",
        "segments": [
            {
                "start": 0.0,
                "end": 0.8,
                "text": "你好。",
                "speaker": "SPEAKER_00",
            },
            {
                "start": 1.0,
                "end": 2.4,
                "text": "你好，很高兴见到你。",
                "speaker": "SPEAKER_01",
            },
        ],
        "speaker_segments": [
            {"speaker": "SPEAKER_00", "start": 0.0, "end": 0.8, "text": "你好。"},
            {
                "speaker": "SPEAKER_01",
                "start": 1.0,
                "end": 2.4,
                "text": "你好，很高兴见到你。",
            },
        ],
    }


class ValidationTests(unittest.TestCase):
    def test_two_speaker_json_renders_labelled_transcript(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "sample.json"
            target = root / "sample.diarized.txt"
            source.write_text(json.dumps(_payload(), ensure_ascii=False), encoding="utf-8")

            result = MODULE.validate_and_render(source, target, expected_speakers=2)

            self.assertEqual(result["speaker_count"], 2)
            rendered = target.read_text(encoding="utf-8")
            self.assertIn("### 00:00:00.000 SPEAKER_00", rendered)
            self.assertIn("### 00:00:01.000 SPEAKER_01", rendered)

    def test_zero_duration_aligned_token_is_preserved_in_rendered_turn(self) -> None:
        payload = {
            "text": "大家好，今天测试，我是甲。你好，欢迎参加，我是乙。",
            "language": "Chinese",
            "segments": [
                {
                    "start": 0.0,
                    "end": 0.2,
                    "text": "大家好今天测试",
                    "speaker": "SPEAKER_00",
                },
                {"start": 0.2, "end": 0.2, "text": "我", "speaker": "SPEAKER_00"},
                {"start": 0.2, "end": 0.6, "text": "是甲", "speaker": "SPEAKER_00"},
                {
                    "start": 1.0,
                    "end": 1.2,
                    "text": "你好欢迎参加",
                    "speaker": "SPEAKER_01",
                },
                {"start": 1.2, "end": 1.2, "text": "我", "speaker": "SPEAKER_01"},
                {"start": 1.2, "end": 1.6, "text": "是乙", "speaker": "SPEAKER_01"},
            ],
            "speaker_segments": [
                {
                    "speaker": "SPEAKER_00",
                    "start": 0.0,
                    "end": 0.6,
                    "text": "大家好今天测试是甲",
                },
                {
                    "speaker": "SPEAKER_01",
                    "start": 1.0,
                    "end": 1.6,
                    "text": "你好欢迎参加是乙",
                },
            ],
        }
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "sample.json"
            target = root / "sample.txt"
            source.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")

            result = MODULE.validate_and_render(source, target, expected_speakers=2)

            self.assertEqual(result["segment_count"], 2)
            rendered = target.read_text(encoding="utf-8")
            self.assertIn("大家好，今天测试，我是甲。", rendered)
            self.assertIn("你好，欢迎参加，我是乙。", rendered)
            self.assertNotIn("大家好今天测试是甲", rendered)

    def test_timestamp_segments_require_safe_speaker_labels(self) -> None:
        payload = _payload()
        del payload["segments"][0]["speaker"]
        with self.assertRaisesRegex(ValueError, "missing: speaker"):
            MODULE._validated_segments(payload, expected_speakers=2)

    def test_known_speaker_count_mismatch_fails(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "sample.json"
            source.write_text(json.dumps(_payload(), ensure_ascii=False), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "speaker count mismatch"):
                MODULE.validate_and_render(
                    source, Path(directory) / "out.txt", expected_speakers=3
                )

    def test_missing_speaker_segments_fails(self) -> None:
        payload = _payload()
        del payload["speaker_segments"]
        with self.assertRaisesRegex(ValueError, "missing speaker_segments"):
            MODULE._validated_segments(payload, expected_speakers=None)

    def test_truncated_transcript_fails(self) -> None:
        payload = _payload()
        payload["truncated"] = True
        with self.assertRaisesRegex(ValueError, "truncated transcript"):
            MODULE._validated_segments(payload, expected_speakers=None)

    def test_length_finish_reason_fails(self) -> None:
        payload = _payload()
        payload["finish_reason"] = "length"
        with self.assertRaisesRegex(ValueError, "incomplete generation"):
            MODULE._validated_segments(payload, expected_speakers=None)

    def test_non_string_transcript_and_turn_text_fail(self) -> None:
        payload = _payload()
        payload["text"] = 123
        with self.assertRaisesRegex(ValueError, "empty transcript"):
            MODULE._validated_segments(payload, expected_speakers=None)

        payload = _payload()
        payload["speaker_segments"][0]["text"] = None
        with self.assertRaisesRegex(ValueError, "text must be a string"):
            MODULE._validated_segments(payload, expected_speakers=None)

    def test_partial_speaker_coverage_fails(self) -> None:
        payload = _payload()
        payload["speaker_segments"] = payload["speaker_segments"][:1]
        with self.assertRaisesRegex(ValueError, "partially covers"):
            MODULE._validated_segments(payload, expected_speakers=1)

    def test_unsafe_speaker_label_fails(self) -> None:
        payload = _payload()
        payload["speaker_segments"][0]["speaker"] = (
            "SPEAKER_00\n### 00:00:00.500 SPEAKER_99"
        )
        with self.assertRaisesRegex(ValueError, "unsafe speaker label"):
            MODULE._validated_segments(payload, expected_speakers=2)

    def test_json_cannot_be_transcript_output(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "sample.json"
            source.write_text(json.dumps(_payload(), ensure_ascii=False), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "must not overwrite"):
                MODULE.validate_and_render(source, source, expected_speakers=2)

    def test_unstamped_json_has_unverified_model(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "sample.json"
            target = Path(directory) / "sample.txt"
            source.write_text(json.dumps(_payload(), ensure_ascii=False), encoding="utf-8")
            result = MODULE.validate_and_render(source, target, expected_speakers=2)
            self.assertEqual(result["model"], "unverified")

    def test_unknown_single_speaker_requires_review(self) -> None:
        payload = _payload()
        for segment in payload["segments"]:
            segment["speaker"] = "SPEAKER_00"
        payload["speaker_segments"] = [
            {
                "speaker": "SPEAKER_00",
                "start": 0.0,
                "end": 2.4,
                "text": payload["text"],
            }
        ]
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "sample.json"
            target = Path(directory) / "sample.txt"
            source.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
            result = MODULE.validate_and_render(source, target, expected_speakers=None)
            self.assertEqual(result["diarization_status"], "needs_review")


class CommandTests(unittest.TestCase):
    def test_audio_path_forces_accuracy_and_diarization_flags(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            audio = root / "sample.wav"
            audio.touch()
            output = root / "output"
            captured: list[str] = []

            def fake_run(command, **kwargs):
                captured.extend(command)
                run_dir = Path(command[command.index("--output-dir") + 1])
                (run_dir / "sample.json").write_text(
                    json.dumps(_payload(), ensure_ascii=False), encoding="utf-8"
                )
                return mock.Mock(returncode=0)

            argv = [
                "transcribe_diarized.py",
                "--audio",
                str(audio),
                "--output-dir",
                str(output),
                "--num-speakers",
                "2",
            ]
            with (
                mock.patch.object(sys, "argv", argv),
                mock.patch.object(MODULE, "_resolve_cli", return_value="/fake/asr"),
                mock.patch.object(MODULE, "_preflight_runtime"),
                mock.patch.object(MODULE.subprocess, "run", side_effect=fake_run),
                mock.patch("builtins.print"),
            ):
                self.assertEqual(MODULE.main(), 0)

            self.assertIn("Qwen/Qwen3-ASR-1.7B", captured)
            self.assertIn("bfloat16", captured)
            self.assertIn("json", captured)
            self.assertIn("--timestamps", captured)
            self.assertIn("Qwen/Qwen3-ForcedAligner-0.6B", captured)
            self.assertIn("--diarize", captured)
            self.assertNotIn("Qwen/Qwen3-ASR-0.6B", captured)

    def test_missing_diarization_access_fails_before_doctor(self) -> None:
        with (
            mock.patch.object(MODULE, "_has_diarization_access", return_value=False),
            mock.patch.object(MODULE.subprocess, "run") as run,
        ):
            with self.assertRaisesRegex(RuntimeError, "hf auth login"):
                MODULE._preflight_runtime("/fake/asr", {})
            run.assert_not_called()

    def test_stale_json_is_not_accepted(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            audio = root / "sample.wav"
            audio.touch()
            (root / "sample.json").write_text(
                json.dumps(_payload(), ensure_ascii=False), encoding="utf-8"
            )
            argv = ["transcribe_diarized.py", "--audio", str(audio)]
            with (
                mock.patch.object(sys, "argv", argv),
                mock.patch.object(MODULE, "_resolve_cli", return_value="/fake/asr"),
                mock.patch.object(MODULE, "_preflight_runtime"),
                mock.patch.object(
                    MODULE.subprocess, "run", return_value=mock.Mock(returncode=0)
                ),
            ):
                with self.assertRaisesRegex(FileNotFoundError, "expected ASR JSON"):
                    MODULE.main()

    def test_transcript_cannot_overwrite_audio(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            audio = Path(directory) / "sample.wav"
            audio.touch()
            argv = [
                "transcribe_diarized.py",
                "--audio",
                str(audio),
                "--transcript-output",
                str(audio),
            ]
            with mock.patch.object(sys, "argv", argv):
                with self.assertRaisesRegex(ValueError, "paths must be distinct"):
                    MODULE.main()


if __name__ == "__main__":
    unittest.main()
