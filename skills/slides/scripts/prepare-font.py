#!/usr/bin/env python3
"""Create an outline-only embedding copy; never change an installed font.

Some Office TTFs contain bitmap strikes that Chromium exports as broken Type3
glyphs. Keep the original outlines, metrics, names and true weights unchanged.
Requires fontTools. Use only fonts the user is entitled to embed.
"""
import argparse
from pathlib import Path
from fontTools.ttLib import TTFont


def prepare_font(source, output, index=-1):
    source, output = Path(source).resolve(), Path(output).resolve()
    if source == output or output.exists():
        raise ValueError("Use a new output path; installed/original fonts must not be overwritten")
    font = TTFont(source, fontNumber=index)
    try:
        if not any(table in font for table in ("glyf", "CFF ", "CFF2")):
            raise ValueError("Font has no vector outlines; refusing to strip bitmap glyphs")
        removed = []
        for table in ("EBDT", "EBLC", "EBSC"):
            if table in font:
                del font[table]
                removed.append(table)
        output.parent.mkdir(parents=True, exist_ok=True)
        font.save(output)
        return removed
    finally:
        font.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("source")
    parser.add_argument("output")
    parser.add_argument("--index", type=int, default=-1, help="Explicit face index for a TTC font collection")
    args = parser.parse_args()
    print("Created outline-only embedding copy; removed bitmap tables:", prepare_font(args.source, args.output, args.index))
