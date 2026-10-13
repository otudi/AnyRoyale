#!/usr/bin/env python3
"""Local inventory of game packages/resources you are entitled to analyse.

Usage:
    python3 tools/asset-inventory/inventory.py PATH [PATH ...] [--out DIR]

PATH may be an .apk/.xapk/.zip, an extracted directory, or single files. For every file found
(including files inside archives, recursively one level for split APKs in .xapk) it records size,
SHA-256, detected format, and whether the format is directly usable on the web, needs conversion,
or is not usable by AnyRoyale. It also tries to read the package name and version from the
binary AndroidManifest.xml.

Output (written locally only, default tools/asset-inventory/output/, which is git-ignored):
    inventory.json   machine-readable list
    inventory.md     summary table

The tool never uploads anything and never copies asset contents. Holding a file and being able to
decode it does not grant the right to redistribute it: see docs/ASSETS.md before using any output.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import struct
import sys
import zipfile
from collections import Counter, defaultdict
from dataclasses import asdict, dataclass

# extension -> (format, web status, note)
FORMATS = {
    ".png": ("PNG image", "web-ready", "usable after licence review"),
    ".jpg": ("JPEG image", "web-ready", "usable after licence review"),
    ".webp": ("WebP image", "web-ready", "usable after licence review"),
    ".ktx": ("KTX texture", "convert", "convert to PNG/WebP or KTX2/Basis for three.js"),
    ".pvr": ("PVR texture", "convert", "convert to PNG/WebP"),
    ".astc": ("ASTC texture", "convert", "convert to PNG/WebP"),
    ".sc": ("Supercell .sc (compressed sprite/texture container)", "convert", "needs a dedicated decoder; not handled here"),
    ".sctx": ("Supercell texture container", "convert", "needs a dedicated decoder"),
    ".scw": ("Supercell 3D model container", "convert", "needs a dedicated decoder; target glTF/GLB"),
    ".glb": ("glTF binary", "web-ready", "loadable by three.js"),
    ".gltf": ("glTF", "web-ready", "loadable by three.js"),
    ".fbx": ("FBX model", "convert", "convert to GLB (e.g. Blender / FBX2glTF)"),
    ".dae": ("Collada model", "convert", "convert to GLB"),
    ".ogg": ("Ogg audio", "web-ready", "not supported by Safari < 17: also produce AAC/MP3"),
    ".mp3": ("MP3 audio", "web-ready", "plays everywhere"),
    ".m4a": ("AAC audio", "web-ready", "plays everywhere"),
    ".wav": ("WAV audio", "convert", "compress to OGG + AAC"),
    ".csv": ("CSV data", "data", "game tables; compare with crforge data, do not ship verbatim"),
    ".json": ("JSON data", "data", ""),
    ".ttf": ("TrueType font", "web-ready", "check font licence"),
    ".otf": ("OpenType font", "web-ready", "check font licence"),
    ".so": ("Native library", "not-usable", "compiled ARM code; not portable to the browser"),
    ".dex": ("Dalvik bytecode", "not-usable", "Android bytecode; not portable"),
    ".arsc": ("Android resources table", "not-usable", ""),
    ".xml": ("XML", "data", ""),
}

MAGIC = [
    (b"\x89PNG", ".png"),
    (b"glTF", ".glb"),
    (b"OggS", ".ogg"),
    (b"ID3", ".mp3"),
    (b"RIFF", ".wav"),
    (b"\xabKTX", ".ktx"),
    (b"PK\x03\x04", ".zip"),
    (b"SC", ".sc"),
    (b"\x7fELF", ".so"),
    (b"dex\n", ".dex"),
]


@dataclass
class Entry:
    container: str
    path: str
    size: int
    sha256: str
    extension: str
    format: str
    web_status: str
    note: str


def sniff(path: str, head: bytes) -> str:
    ext = os.path.splitext(path)[1].lower()
    if ext in FORMATS:
        return ext
    for magic, guessed in MAGIC:
        if head.startswith(magic):
            return guessed
    return ext or "(none)"


def classify(container: str, path: str, data: bytes) -> Entry:
    ext = sniff(path, data[:16])
    fmt, status, note = FORMATS.get(ext, ("unknown", "unknown", ""))
    return Entry(container, path, len(data), hashlib.sha256(data).hexdigest(), ext, fmt, status, note)


def read_manifest(data: bytes) -> dict:
    """Minimal Android binary-XML reader for package / versionCode / versionName."""
    out: dict = {}
    try:
        if struct.unpack_from("<H", data, 0)[0] != 0x0003:
            return out
        pos = 8
        strings: list[str] = []
        while pos < len(data):
            chunk_type, header_size, chunk_size = struct.unpack_from("<HHI", data, pos)
            if chunk_type == 0x0001:  # string pool
                count, _style, flags, str_start, _ = struct.unpack_from("<IIIII", data, pos + 8)
                utf8 = flags & 0x100
                offsets = struct.unpack_from(f"<{count}I", data, pos + header_size)
                base = pos + str_start
                for off in offsets:
                    p = base + off
                    if utf8:
                        n = data[p + 1] if data[p] & 0x80 == 0 else data[p + 2]
                        skip = 2 if data[p] & 0x80 == 0 else 3
                        if data[p + skip - 1] & 0x80:
                            skip += 1
                        strings.append(data[p + skip : p + skip + n].decode("utf-8", "replace"))
                    else:
                        n = struct.unpack_from("<H", data, p)[0]
                        strings.append(data[p + 2 : p + 2 + n * 2].decode("utf-16le", "replace"))
            elif chunk_type == 0x0102:  # start element
                name_idx = struct.unpack_from("<I", data, pos + 20)[0]
                if 0 <= name_idx < len(strings) and strings[name_idx] == "manifest":
                    attr_start, attr_size, attr_count = struct.unpack_from("<HHH", data, pos + 24)
                    a = pos + 16 + attr_start
                    for i in range(attr_count):
                        _ns, aname, araw, _sz, _res0, atype, adata = struct.unpack_from("<IIIHBBI", data, a + i * attr_size)
                        key = strings[aname] if aname < len(strings) else ""
                        if araw != 0xFFFFFFFF and araw < len(strings):
                            val = strings[araw]
                        elif atype == 0x10:
                            val = adata
                        else:
                            val = adata
                        if key in ("package", "versionCode", "versionName"):
                            out[key] = val
                    return out
            pos += chunk_size if chunk_size else 8
    except (struct.error, IndexError):
        return out
    return out


def walk_zip(name: str, blob: bytes, entries: list[Entry], meta: dict, depth: int = 0) -> None:
    with zipfile.ZipFile(io.BytesIO(blob)) as z:
        for info in z.infolist():
            if info.is_dir():
                continue
            data = z.read(info)
            if info.filename == "AndroidManifest.xml":
                meta.setdefault(name, {}).update(read_manifest(data))
            if depth == 0 and info.filename.lower().endswith(".apk"):
                walk_zip(f"{name}!{info.filename}", data, entries, meta, depth + 1)
                continue
            entries.append(classify(name, info.filename, data))


def scan(paths: list[str]) -> tuple[list[Entry], dict]:
    entries: list[Entry] = []
    meta: dict = {}
    for p in paths:
        if os.path.isdir(p):
            for dirpath, _dirs, files in os.walk(p):
                for f in files:
                    full = os.path.join(dirpath, f)
                    with open(full, "rb") as fh:
                        data = fh.read()
                    rel = os.path.relpath(full, p)
                    if f.lower().endswith((".apk", ".xapk", ".zip")) and data[:4] == b"PK\x03\x04":
                        walk_zip(rel, data, entries, meta)
                    else:
                        entries.append(classify(p, rel, data))
        elif os.path.isfile(p):
            with open(p, "rb") as fh:
                data = fh.read()
            if data[:4] == b"PK\x03\x04":
                walk_zip(os.path.basename(p), data, entries, meta)
            else:
                entries.append(classify(os.path.dirname(p), os.path.basename(p), data))
        else:
            print(f"skip (not found): {p}", file=sys.stderr)
    return entries, meta


def write_report(entries: list[Entry], meta: dict, out_dir: str) -> None:
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, "inventory.json"), "w", encoding="utf-8") as fh:
        json.dump({"packages": meta, "files": [asdict(e) for e in entries]}, fh, indent=1)
    by_status = Counter(e.web_status for e in entries)
    by_format: dict = defaultdict(lambda: [0, 0])
    for e in entries:
        by_format[e.format][0] += 1
        by_format[e.format][1] += e.size
    dup = Counter(e.sha256 for e in entries)
    lines = ["# Asset inventory (local, do not commit)", ""]
    for name, m in meta.items():
        lines.append(f"- `{name}`: package `{m.get('package', '?')}`, version {m.get('versionName', '?')} ({m.get('versionCode', '?')})")
    lines += ["", f"Files: {len(entries)}; duplicates by hash: {sum(1 for c in dup.values() if c > 1)}", ""]
    lines += ["| Web status | Files |", "|---|---|"] + [f"| {k} | {v} |" for k, v in by_status.most_common()]
    lines += ["", "| Format | Files | MB |", "|---|---|---|"]
    for fmt, (n, size) in sorted(by_format.items(), key=lambda kv: -kv[1][1]):
        lines.append(f"| {fmt} | {n} | {size / 1048576:.1f} |")
    lines += ["", "Statuses: web-ready = a browser can load the format; convert = needs a decoder/converter;",
              "data = tables/configs; not-usable = native code. None of this implies permission to redistribute."]
    with open(os.path.join(out_dir, "inventory.md"), "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("paths", nargs="+")
    ap.add_argument("--out", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "output"))
    args = ap.parse_args()
    entries, meta = scan(args.paths)
    write_report(entries, meta, args.out)
    print(f"{len(entries)} files inventoried -> {args.out}/inventory.md")
    return 0


if __name__ == "__main__":
    sys.exit(main())
