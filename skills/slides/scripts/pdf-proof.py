#!/usr/bin/env python3
"""Render the actual final PDF and audit embedded fonts. Requires PyMuPDF.

No network, model or user directory access. Inputs and outputs are explicit.
"""
import argparse
import hashlib
import json
import math
import re
from pathlib import Path

import fitz


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def font_matches(actual, expected):
    def normalize(value):
        return re.sub(r"[\s_-]", "", re.sub(r"^[A-Z]{6}\+", "", value)).lower().removeprefix("st")
    return normalize(actual).startswith(normalize(expected)) if expected else False


def inspect_pdf(pdf, receipt, sheet):
    doc = fitz.open(pdf)
    failures, fonts, pages = [], [], []
    if doc.page_count != receipt["pages"]:
        failures.append("PDF page count differs from HTML")
    if not doc.page_count:
        raise ValueError("PDF contains no pages")
    expected = receipt["fontSummary"]
    bold_cjk = 0
    preview = fitz.open()
    columns = min(4, doc.page_count)
    contact = preview.new_page(width=columns * 420, height=math.ceil(doc.page_count / columns) * 350)
    for index, page in enumerate(doc):
        dimensions = [round(page.rect.width, 2), round(page.rect.height, 2)]
        detail = receipt["details"][min(index, len(receipt["details"]) - 1)]
        # HTML QA dimensions are CSS pixels; PDF uses 72 dpi points.
        target = [detail.get("width", 1056) * .75, detail.get("height", 816) * .75]
        if any(abs(a - b) > 2 for a, b in zip(dimensions, target)):
            failures.append(f"Page {index + 1}: PDF size {dimensions} differs from HTML {target}")
        page_fonts = []
        for entry in page.get_fonts(full=True):
            xref, extension, kind, basefont = entry[:4]
            embedded = bool(xref and doc.extract_font(xref)[3])
            page_fonts.append({"name": basefont, "embedded": embedded})
            if not embedded:
                failures.append(f"Page {index + 1}: font not embedded: {basefont}")
        fonts.append({"page": index + 1, "fonts": page_fonts})
        for block in page.get_text("dict")["blocks"]:
            for line in block.get("lines", []):
                for span in line["spans"]:
                    text, font = span["text"], span["font"]
                    cjk = bool(re.search(r"[\u3400-\u9fff]", text))
                    latin = bool(re.search(r"[A-Za-z0-9]", text))
                    if cjk and not font_matches(font, expected.get("expectedCjkFont")):
                        failures.append(f"Page {index + 1}: unexpected Chinese font {font}")
                    if latin and not font_matches(font, expected.get("expectedLatinFont")):
                        failures.append(f"Page {index + 1}: unexpected Latin font {font}")
                    if cjk and re.search(r"bold|demi|heavy|black", font, re.I):
                        bold_cjk += 1
        # Every page is rendered from PDF bytes, never from the HTML screenshot.
        pix = page.get_pixmap(matrix=fitz.Matrix(1.5, 1.5), alpha=False)
        x, y = index % columns * 420, index // columns * 350
        contact.insert_text((x + 12, y + 17), f"Page {index + 1}", fontsize=12)
        contact.insert_image(fitz.Rect(x + 10, y + 26, x + 410, y + 340), stream=pix.tobytes("png"))
        pages.append({"page": index + 1, "dimensions": dimensions, "rendered": True})
    if expected.get("boldCjkTargets", 0) > 0 and not bold_cjk:
        failures.append("PDF contains no real bold Chinese face")
    contact.get_pixmap(alpha=False).save(sheet)
    return {"contractVersion": "DOMI_SLIDES_PDF_PROOF_V1", "pdfSha256": digest(pdf),
            "htmlSha256": receipt["html"]["sha256"], "pages": pages, "fonts": fonts,
            "contactSheet": {"path": str(Path(sheet).resolve()), "sha256": digest(sheet)},
            "failures": sorted(set(failures)), "status": "failed" if failures else "passed"}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("pdf")
    parser.add_argument("receipt")
    parser.add_argument("sheet")
    parser.add_argument("report")
    args = parser.parse_args()
    report = inspect_pdf(args.pdf, json.loads(Path(args.receipt).read_text()), args.sheet)
    Path(args.report).write_text(json.dumps(report, ensure_ascii=False, indent=2))
    if report["failures"]:
        raise SystemExit("PDF QA failed: " + "; ".join(report["failures"]))
