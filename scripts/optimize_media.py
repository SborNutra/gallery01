#!/usr/bin/env python3
"""Make the site light without manual work.

1. Shards: for every image in assets/pics/ build a small WebP preview in
   assets/pics/thumbs/<name>.webp (the grid loads these, the overlay loads the original).
2. Cases: every image in data/cases.json (cover + gallery) is turned into a
   resized WebP inside assets/cases/ — remote links (Behance, hsedesign…) are
   downloaded, local jpg/png uploads are converted — and the JSON is rewritten
   to point at the local files.

Runs in GitHub Actions on every push (see .github/workflows/optimize-media.yml),
and can be run locally: python scripts/optimize_media.py
"""
from __future__ import annotations

import base64
import hashlib
import io
import json
import re
import sys
import urllib.request
from pathlib import Path

from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parent.parent
PICS = ROOT / "assets" / "pics"
THUMBS = PICS / "thumbs"
THUMB_MANIFEST = THUMBS / "manifest.json"
CASES_JSON = ROOT / "data" / "cases.json"
CASES_DIR = ROOT / "assets" / "cases"

THUMB_WIDTH = 720
COVER_WIDTH = 1600
GALLERY_WIDTH = 1200
QUALITY = 80

RASTER = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/128.0 Safari/537.36"
)


def log(msg: str) -> None:
    print(msg, flush=True)


def sha1(data: bytes) -> str:
    return hashlib.sha1(data).hexdigest()


def encode_webp(data: bytes, max_width: int) -> bytes:
    """Resize (never upscale) and encode as WebP. Animated GIF/WebP stay animated."""
    im = Image.open(io.BytesIO(data))
    out = io.BytesIO()

    if getattr(im, "is_animated", False) and getattr(im, "n_frames", 1) > 1:
        frames, durations = [], []
        for i in range(im.n_frames):
            im.seek(i)
            frame = im.convert("RGBA")
            if frame.width > max_width:
                frame = frame.resize((max_width, round(frame.height * max_width / frame.width)), Image.LANCZOS)
            frames.append(frame)
            durations.append(im.info.get("duration", 80))
        frames[0].save(out, "WEBP", save_all=True, append_images=frames[1:], duration=durations,
                       loop=0, quality=70, method=4)
        return out.getvalue()

    im = ImageOps.exif_transpose(im)
    has_alpha = im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info)
    im = im.convert("RGBA" if has_alpha else "RGB")
    if im.width > max_width:
        im = im.resize((max_width, round(im.height * max_width / im.width)), Image.LANCZOS)
    im.save(out, "WEBP", quality=QUALITY, method=6)
    return out.getvalue()


# --------------------------------------------------------------------------
# Shards thumbnails
# --------------------------------------------------------------------------
def build_thumbs() -> int:
    if not PICS.exists():
        return 0
    THUMBS.mkdir(parents=True, exist_ok=True)
    try:
        manifest = json.loads(THUMB_MANIFEST.read_text())
    except Exception:
        manifest = {}

    changed = 0
    sources = sorted(p for p in PICS.iterdir() if p.is_file() and p.suffix.lower() in RASTER)
    for src in sources:
        data = src.read_bytes()
        digest = sha1(data)
        target = THUMBS / f"{src.stem}.webp"
        if manifest.get(src.name) == digest and target.exists():
            continue
        try:
            target.write_bytes(encode_webp(data, THUMB_WIDTH))
        except Exception as exc:  # broken file: skip, the site falls back to the original
            log(f"  ! thumb failed for {src.name}: {exc}")
            continue
        manifest[src.name] = digest
        changed += 1
        log(f"  thumb {src.name}: {len(data)//1024} KB -> {target.stat().st_size//1024} KB")

    # drop thumbs whose source was removed
    alive = {p.name for p in sources}
    for name in list(manifest):
        if name not in alive:
            (THUMBS / f"{Path(name).stem}.webp").unlink(missing_ok=True)
            del manifest[name]
            changed += 1

    THUMB_MANIFEST.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    return changed


# --------------------------------------------------------------------------
# Cases
# --------------------------------------------------------------------------
def slugify(text: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return slug or "case"


def is_remote(ref: str) -> bool:
    return ref.startswith(("http://", "https://"))


def local_path(ref: str) -> Path:
    return ROOT / ref.lstrip("/")


def extension_of(ref: str) -> str:
    return Path(ref.split("?")[0].split("#")[0]).suffix.lower()


def download(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "image/*,*/*"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return resp.read()


def behance_cover_crop(url: str, data: bytes) -> bytes:
    """Behance cover links carry the crop in the file name (base64 "crop,w,h,x,y").
    The /projects/original/ file is uncropped, so apply that crop ourselves."""
    match = re.search(r"behance\.net/projects/[^/]+/[0-9a-f]+\.([A-Za-z0-9_-]+)\.\w+$", url)
    if not match:
        return data
    try:
        token = match.group(1)
        parts = base64.urlsafe_b64decode(token + "=" * (-len(token) % 4)).decode().split(",")
        if parts[0] != "crop":
            return data
        w, h, x, y = (int(v) for v in parts[1:5])
        im = Image.open(io.BytesIO(data))
        if im.width < x + w or im.height < y + h:
            return data  # already the cropped version
        out = io.BytesIO()
        im.convert("RGBA" if im.mode in ("RGBA", "LA", "P") else "RGB").crop((x, y, x + w, y + h)).save(out, "PNG")
        return out.getvalue()
    except Exception:
        return data


def localize(ref: str, target_name: str, max_width: int) -> str:
    """Return the new reference for an image (or the old one if nothing to do / failed)."""
    if not ref:
        return ref
    ext = extension_of(ref)
    if ext in {".mp4", ".webm", ".mov"}:
        return ref  # videos are left as they are

    target = CASES_DIR / target_name
    new_ref = "/" + str(target.relative_to(ROOT)).replace("\\", "/")

    try:
        if is_remote(ref):
            data = behance_cover_crop(ref, download(ref))
        else:
            src = local_path(ref)
            if not src.exists():
                return ref
            data = src.read_bytes()
            if src == target:
                # already ours — only shrink if someone replaced it with something huge
                with Image.open(io.BytesIO(data)) as im:
                    if im.width <= max_width and len(data) < 400_000:
                        return ref
            elif ext == ".webp" and len(data) < 400_000:
                with Image.open(io.BytesIO(data)) as im:
                    if im.width <= max_width:
                        return ref

        encoded = encode_webp(data, max_width)
        CASES_DIR.mkdir(parents=True, exist_ok=True)
        target.write_bytes(encoded)
        log(f"  {ref[:80]} -> {new_ref} ({len(data)//1024} KB -> {len(encoded)//1024} KB)")

        # an original uploaded into assets/cases is replaced by its webp
        if not is_remote(ref):
            src = local_path(ref)
            if src != target and CASES_DIR in src.parents:
                src.unlink(missing_ok=True)
        return new_ref
    except Exception as exc:
        log(f"  ! could not process {ref[:80]}: {exc}")
        return ref


def optimize_cases() -> bool:
    if not CASES_JSON.exists():
        return False
    raw = CASES_JSON.read_text(encoding="utf-8")
    cases = json.loads(raw)

    used_slugs: set[str] = set()
    for case in cases:
        if not isinstance(case, dict) or not case.get("title"):
            continue
        slug = slugify(str(case["title"]))
        while slug in used_slugs:
            slug += "-x"
        used_slugs.add(slug)

        if case.get("cover"):
            case["cover"] = localize(str(case["cover"]), f"{slug}-cover.webp", COVER_WIDTH)

        gallery = case.get("gallery") or []
        if isinstance(gallery, str):
            gallery = [gallery]
        case["gallery"] = [
            localize(str(item), f"{slug}-{i + 1}.webp", GALLERY_WIDTH)
            for i, item in enumerate(gallery) if item
        ]

    new_raw = json.dumps(cases, ensure_ascii=False, indent=2) + "\n"
    if new_raw != raw:
        CASES_JSON.write_text(new_raw, encoding="utf-8")
        return True
    return False


def main() -> int:
    log("Shards thumbnails:")
    n = build_thumbs()
    log(f"  {n} updated")
    log("Cases:")
    changed = optimize_cases()
    log(f"  cases.json {'updated' if changed else 'unchanged'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
