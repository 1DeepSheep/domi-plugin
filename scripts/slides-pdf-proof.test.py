import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path

import fitz

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("proof", Path(__file__).resolve().parents[1] / "skills/slides/scripts/pdf-proof.py")
proof = importlib.util.module_from_spec(spec)
spec.loader.exec_module(proof)


class PdfProofTest(unittest.TestCase):
    def test_real_pdf_render_fonts_and_mismatch(self):
        with tempfile.TemporaryDirectory(prefix="domi-pdf-proof-") as directory:
            root = Path(directory)
            # The built-in CJK face ships with PyMuPDF; no system font or
            # optional pymupdf-fonts package is needed on CI.
            font = fitz.Font("cjk")
            doc = fitz.open()
            for _ in range(2):
                page = doc.new_page(width=792, height=612)
                page.insert_font(fontname="FixtureFont", fontbuffer=font.buffer)
                page.insert_text((50, 90), "Synthetic PDF quality check", fontname="FixtureFont", fontsize=20)
            pdf = root / "fixture.pdf"
            doc.save(pdf)
            doc.close()
            with fitz.open(pdf) as actual:
                actual_font = actual[0].get_text("dict")["blocks"][0]["lines"][0]["spans"][0]["font"]
            receipt = {"pages": 2, "html": {"sha256": "synthetic-html"}, "details": [{"width":1056,"height":816}]*2,
                       "fontSummary": {"expectedLatinFont": actual_font, "expectedCjkFont": "Kaiti SC"}}
            report = proof.inspect_pdf(pdf, receipt, root / "sheet.png")
            self.assertEqual(report["status"], "passed", report["failures"])
            self.assertEqual(len(report["pages"]), 2)
            self.assertTrue(all(font["embedded"] for page in report["fonts"] for font in page["fonts"]))
            self.assertEqual(report["pdfSha256"], proof.digest(pdf))
            self.assertGreater((root / "sheet.png").stat().st_size, 1000)
            receipt["fontSummary"]["expectedLatinFont"] = "MissingFont"
            self.assertEqual(proof.inspect_pdf(pdf, receipt, root / "bad-font.png")["status"], "failed")
            receipt["fontSummary"]["expectedLatinFont"] = actual_font
            receipt["fontSummary"]["boldCjkTargets"] = 1
            self.assertIn("PDF contains no real bold Chinese face", proof.inspect_pdf(pdf, receipt, root / "bad-bold.png")["failures"])
            receipt["pages"] = 3
            self.assertIn("PDF page count differs from HTML", proof.inspect_pdf(pdf, receipt, root / "bad-pages.png")["failures"])


if __name__ == "__main__":
    unittest.main()
