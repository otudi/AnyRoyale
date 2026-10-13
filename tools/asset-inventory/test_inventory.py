"""Self-test for inventory.py using a synthetic package (no third-party files involved)."""
import io
import json
import os
import tempfile
import unittest
import zipfile

import inventory


class InventoryTest(unittest.TestCase):
    def test_classifies_files_inside_nested_packages(self):
        inner = io.BytesIO()
        with zipfile.ZipFile(inner, "w") as z:
            z.writestr("lib/arm64-v8a/libgame.so", b"\x7fELF" + b"0" * 64)
            z.writestr("assets/sfx/hit.ogg", b"OggS" + b"1" * 32)
        outer = io.BytesIO()
        with zipfile.ZipFile(outer, "w") as z:
            z.writestr("base.apk", inner.getvalue())
            z.writestr("assets/ui/icon.png", b"\x89PNG" + b"2" * 32)
            z.writestr("assets/data/cards.csv", b"name,cost\nknight,3\n")
            z.writestr("assets/sc/ui.sc", b"SC" + b"3" * 40)
        with tempfile.TemporaryDirectory() as tmp:
            pkg = os.path.join(tmp, "game.xapk")
            with open(pkg, "wb") as fh:
                fh.write(outer.getvalue())
            entries, _meta = inventory.scan([pkg])
            by_path = {e.path: e for e in entries}
            self.assertEqual(by_path["lib/arm64-v8a/libgame.so"].web_status, "not-usable")
            self.assertEqual(by_path["assets/sfx/hit.ogg"].web_status, "web-ready")
            self.assertEqual(by_path["assets/ui/icon.png"].format, "PNG image")
            self.assertEqual(by_path["assets/data/cards.csv"].web_status, "data")
            self.assertEqual(by_path["assets/sc/ui.sc"].web_status, "convert")
            out = os.path.join(tmp, "out")
            inventory.write_report(entries, _meta, out)
            data = json.load(open(os.path.join(out, "inventory.json")))
            self.assertEqual(len(data["files"]), 5)
            self.assertTrue(os.path.exists(os.path.join(out, "inventory.md")))


if __name__ == "__main__":
    unittest.main()
