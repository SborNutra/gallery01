#!/usr/bin/env python3
"""Make the site light without manual work.

1. Shards: for every image in assets/pics/ build a small WebP preview in
   assets/pics/thumbs/<name>.webp (the grid loads these, the overlay loads the original).
2. Cases: every image in data/cases.json (cover + gallery) is turned into a
   resized WebP inside assets/cases/ — remote links (Behance, hsedesign…) are
   downloaded, local jpg/png uploads are converted — and the JSON is rewritten
   to point at the local files.

3. Shards: empty fields in data/shards.json (link name, size, date) are filled in.
4. feed.xml (Atom/RSS) with the latest works and cases.
5. Link previews (Open Graph images) in assets/og/ for shards, cases and about.

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
import shutil
import subprocess
import urllib.request
from datetime import date, datetime, timezone
from html import escape
from pathlib import Path

from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parent.parent
PICS = ROOT / "assets" / "pics"
THUMBS = PICS / "thumbs"
THUMB_MANIFEST = THUMBS / "manifest.json"
CASES_JSON = ROOT / "data" / "cases.json"
CASES_DIR = ROOT / "assets" / "cases"
SHARDS_JSON = ROOT / "data" / "shards.json"
FEED = ROOT / "feed.xml"
OG_DIR = ROOT / "assets" / "og"
FONTS = ROOT / "assets" / "fonts"

# public address of the site — change it here if the site moves to its own domain
SITE_URL = "https://sbornutra.github.io/gallery01/"
SITE_NAME = "sbor"

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


# --------------------------------------------------------------------------
# Shards: fill in what the CMS form left empty
# --------------------------------------------------------------------------
SIZE_IN_NAME = re.compile(r"-(\d{2,5})x(\d{2,5})$")


def media_size(path: Path) -> str:
    match = SIZE_IN_NAME.search(path.stem)
    if match:
        return f"{match.group(1)}x{match.group(2)}"
    try:
        with Image.open(path) as im:
            return f"{im.width}x{im.height}"
    except Exception:
        pass
    if shutil.which("ffprobe"):
        try:
            out = subprocess.run(
                ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                 "stream=width,height", "-of", "csv=p=0:s=x", str(path)],
                capture_output=True, text=True, check=True).stdout.strip()
            if re.fullmatch(r"\d+x\d+", out):
                return out
        except Exception:
            pass
    return ""


def fill_shards() -> bool:
    if not SHARDS_JSON.exists():
        return False
    raw = SHARDS_JSON.read_text(encoding="utf-8")
    shards = json.loads(raw)
    used = {str(s.get("id", "")).lower() for s in shards if isinstance(s, dict) and s.get("id")}
    for shard in shards:
        if not isinstance(shard, dict) or not shard.get("image"):
            continue
        path = local_path(str(shard["image"]))
        if not shard.get("id"):
            base = SIZE_IN_NAME.sub("", path.stem) or "work"
            candidate, n = base, 2
            while candidate.lower() in used:
                candidate, n = f"{base}-{n}", n + 1
            shard["id"] = candidate
            used.add(candidate.lower())
        if not shard.get("resolution") and path.exists():
            shard["resolution"] = media_size(path)
        if not shard.get("date"):
            shard["date"] = date.today().isoformat()
        if isinstance(shard.get("tags"), str):
            shard["tags"] = [t.strip() for t in shard["tags"].split(",") if t.strip()]
    new_raw = json.dumps(shards, ensure_ascii=False, indent=2) + "\n"
    if new_raw != raw:
        SHARDS_JSON.write_text(new_raw, encoding="utf-8")
        return True
    return False


def load_list(path: Path) -> list[dict]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return [d for d in data if isinstance(d, dict) and not d.get("hidden")]
    except Exception:
        return []


def parse_day(value: str) -> datetime:
    try:
        return datetime.strptime(str(value)[:10], "%Y-%m-%d").replace(tzinfo=timezone.utc, hour=12)
    except Exception:
        return datetime(2000, 1, 1, tzinfo=timezone.utc)


def absolute(ref: str) -> str:
    return ref if is_remote(ref) else SITE_URL + ref.lstrip("/")


def thumb_for(ref: str) -> str:
    path = local_path(ref)
    if path.parent == PICS and path.suffix.lower() in RASTER:
        return "/assets/pics/thumbs/" + path.stem + ".webp"
    return ref


# --------------------------------------------------------------------------
# feed.xml — new works for anyone following with an RSS reader
# --------------------------------------------------------------------------
def build_feed() -> bool:
    shards = sorted(load_list(SHARDS_JSON), key=lambda s: parse_day(s.get("date", "")), reverse=True)[:40]
    cases = load_list(CASES_JSON)
    entries = []
    for s in shards:
        when = parse_day(s.get("date", ""))
        link = f"{SITE_URL}index.html#{s.get('id', '')}"
        title = s.get("caption") or s.get("id") or "work"
        tags = ", ".join(s.get("tags") or [])
        picture = absolute(thumb_for(str(s["image"])))
        is_video = extension_of(str(s["image"])) in {".webm", ".mp4", ".mov"}
        body = (f'<p><a href="{escape(link)}">{escape(title)}</a> — {escape(tags)}</p>'
                + ("" if is_video else f'<p><img src="{escape(picture)}" alt="{escape(title)}"/></p>'))
        entries.append((when, f"""  <entry>
    <title>{escape(title)}</title>
    <link href="{escape(link)}"/>
    <id>{escape(link)}</id>
    <updated>{when.isoformat()}</updated>
    <category term="shards"/>
    <content type="html">{escape(body)}</content>
  </entry>"""))
    for c in cases:
        year = str(c.get("year") or "")
        when = parse_day(f"{year}-01-01") if year.isdigit() else datetime(2000, 1, 1, tzinfo=timezone.utc)
        link = c.get("url") or f"{SITE_URL}cases.html"
        title = f"{c.get('title', '')} — {c.get('subtitle', '')}".strip(" —")
        cover = absolute(str(c.get("cover") or ""))
        body = f'<p>{escape(title)}</p>' + (f'<p><img src="{escape(cover)}" alt=""/></p>' if c.get("cover") else "")
        entries.append((when, f"""  <entry>
    <title>{escape(title)}</title>
    <link href="{escape(link)}"/>
    <id>{escape(SITE_URL + "cases.html#" + slugify(str(c.get("title", ""))))}</id>
    <updated>{when.isoformat()}</updated>
    <category term="cases"/>
    <content type="html">{escape(body)}</content>
  </entry>"""))
    entries.sort(key=lambda e: e[0], reverse=True)
    updated = entries[0][0].isoformat() if entries else datetime(2000, 1, 1, tzinfo=timezone.utc).isoformat()
    xml = f"""<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>{SITE_NAME} — new works</title>
  <link href="{SITE_URL}"/>
  <link rel="self" href="{SITE_URL}feed.xml"/>
  <id>{SITE_URL}</id>
  <updated>{updated}</updated>
  <author><name>Maxim Dubnev</name></author>
{chr(10).join(e[1] for e in entries)}
</feed>
"""
    old = FEED.read_text(encoding="utf-8") if FEED.exists() else ""
    if xml != old:
        FEED.write_text(xml, encoding="utf-8")
        return True
    return False


# --------------------------------------------------------------------------
# Link previews (Open Graph) — 1200×630, rebuilt from the latest work
# --------------------------------------------------------------------------
OG_W, OG_H = 1200, 630
BG = (14, 14, 14)


def font(name: str, size: int):
    from PIL import ImageFont
    for candidate in (FONTS / name,):
        try:
            return ImageFont.truetype(str(candidate), size)
        except Exception:
            continue
    return ImageFont.load_default()


def open_still(ref: str) -> Image.Image | None:
    path = local_path(thumb_for(ref))
    if not path.exists():
        path = local_path(ref)
    try:
        im = Image.open(path)
        im.seek(0)
        return ImageOps.exif_transpose(im).convert("RGB")
    except Exception:
        return None


def cover_fit(im: Image.Image, w: int, h: int) -> Image.Image:
    return ImageOps.fit(im, (w, h), Image.LANCZOS, centering=(0.5, 0.45))


def rounded(im: Image.Image, radius: int) -> Image.Image:
    from PIL import ImageDraw
    mask = Image.new("L", im.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, im.width - 1, im.height - 1), radius, fill=255)
    out = Image.new("RGBA", im.size)
    out.paste(im, (0, 0), mask)
    return out


def og_canvas(title: str, subtitle: str) -> Image.Image:
    from PIL import ImageDraw
    canvas = Image.new("RGB", (OG_W, OG_H), BG)
    draw = ImageDraw.Draw(canvas)
    draw.text((64, 64), SITE_NAME, font=font("InstrumentSerif-Italic.ttf", 96), fill=(255, 255, 255))
    draw.text((66, 190), title, font=font("SuisseIntl-Regular.otf", 40), fill=(255, 255, 255))
    y = 250
    for line in subtitle.split("\n"):
        draw.text((66, y), line, font=font("SuisseIntl-Regular.otf", 26), fill=(150, 150, 150))
        y += 36
    draw.text((66, OG_H - 84), SITE_URL.replace("https://", "").rstrip("/"),
              font=font("SuisseIntl-Regular.otf", 22), fill=(110, 110, 110))
    return canvas


def og_tiles(canvas: Image.Image, pictures: list[Image.Image], cols: int, rows: int) -> None:
    # a grid of works on the right half
    x0, y0, gap = 560, 40, 14
    w = (OG_W - x0 - 40 - gap * (cols - 1)) // cols
    h = (OG_H - y0 * 2 - gap * (rows - 1)) // rows
    for i, pic in enumerate(pictures[: cols * rows]):
        tile = rounded(cover_fit(pic, w, h), 14)
        canvas.paste(tile, (x0 + (i % cols) * (w + gap), y0 + (i // cols) * (h + gap)), tile)


def save_if_changed(im: Image.Image, path: Path) -> bool:
    buf = io.BytesIO()
    im.convert("RGB").save(buf, "JPEG", quality=86, optimize=True, progressive=True)
    data = buf.getvalue()
    if path.exists() and path.read_bytes() == data:
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return True


def build_og() -> int:
    changed = 0
    shards = sorted(load_list(SHARDS_JSON), key=lambda s: parse_day(s.get("date", "")), reverse=True)
    stills = [im for im in (open_still(str(s["image"])) for s in shards
                            if extension_of(str(s["image"])) in RASTER) if im][:6]
    canvas = og_canvas("shards", "3d, motion & generative works\nby Maxim Dubnev")
    og_tiles(canvas, stills, 3, 2)
    changed += save_if_changed(canvas, OG_DIR / "shards.jpg")

    covers = [im for im in (open_still(str(c.get("cover") or "")) for c in load_list(CASES_JSON)
                            if c.get("cover")) if im][:4]
    canvas = og_canvas("cases", "branding, identity & motion\nby Maxim Dubnev")
    og_tiles(canvas, covers, 2, 2)
    changed += save_if_changed(canvas, OG_DIR / "cases.jpg")

    canvas = og_canvas("about", "Maxim Dubnev — designer\n3d, branding & motion")
    og_tiles(canvas, stills[:2], 2, 1)
    avatar = open_still("/assets/avatar.jpg")
    if avatar:
        # the avatar is small, so it stays small: a 120px badge in the text column
        badge = rounded(cover_fit(avatar, 120, 120), 18)
        canvas.paste(badge, (66, 350), badge)
    changed += save_if_changed(canvas, OG_DIR / "about.jpg")
    return changed


# --------------------------------------------------------------------------
# Cache busting: css/x.css → css/x.css?v=<hash of the file>, so browsers never mix
# a fresh page with an old cached script
# --------------------------------------------------------------------------
ASSET_REF = re.compile(r'((?:src|href)=")((?:css|js)/[\w./-]+\.(?:css|js))(?:\?v=[0-9a-f]+)?(")')


def stamp_assets() -> int:
    changed = 0
    for page in sorted(ROOT.glob("*.html")):
        html = page.read_text(encoding="utf-8")

        def repl(m: re.Match) -> str:
            target = ROOT / m.group(2)
            if not target.exists():
                return m.group(0)
            return f"{m.group(1)}{m.group(2)}?v={sha1(target.read_bytes())[:8]}{m.group(3)}"

        new_html = ASSET_REF.sub(repl, html)
        if new_html != html:
            page.write_text(new_html, encoding="utf-8")
            changed += 1
    return changed


def main() -> int:
    log("Shards data:")
    log(f"  shards.json {'updated' if fill_shards() else 'unchanged'}")
    log("Shards thumbnails:")
    n = build_thumbs()
    log(f"  {n} updated")
    log("Cases:")
    changed = optimize_cases()
    log(f"  cases.json {'updated' if changed else 'unchanged'}")
    log(f"Feed: {'updated' if build_feed() else 'unchanged'}")
    log(f"Link previews: {build_og()} updated")
    log(f"Cache stamps: {stamp_assets()} pages updated")
    return 0


if __name__ == "__main__":
    sys.exit(main())
