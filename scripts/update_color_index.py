#!/usr/bin/env python3
from __future__ import annotations

import argparse
import colorsys
from collections import OrderedDict
from pathlib import Path

from PIL import Image

REQUIRED_KEYS = ("dominantHue", "secondaryHue", "weight", "saturation")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Compute and store color index data for image references in markdown front matter."
    )
    parser.add_argument("--content-glob", default="content/*.md")
    parser.add_argument("--repo-root", default=".")
    parser.add_argument("--image-key", default="image")
    parser.add_argument("--size", type=int, default=64)
    return parser.parse_args()


def split_front_matter(text: str) -> tuple[str | None, str]:
    if not text.startswith("---\n"):
        return None, text

    parts = text.split("\n---\n", 1)
    if len(parts) != 2:
        return None, text

    return parts[0][4:], parts[1]


def parse_front_matter_map(front_matter: str) -> OrderedDict[str, str]:
    data: OrderedDict[str, str] = OrderedDict()
    for raw_line in front_matter.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        data[key.strip()] = value.strip()
    return data


def strip_quotes(value: str) -> str:
    if (value.startswith('"') and value.endswith('"')) or (value.startswith("'") and value.endswith("'")):
        return value[1:-1]
    return value


def format_scalar(value: str | int | float) -> str:
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        return f"{value:.4f}".rstrip("0").rstrip(".") if value != 0 else "0"

    text = str(value)
    if not text:
        return '""'
    if any(ch in text for ch in [":", "#"]) or text != text.strip() or " " in text:
        return f'"{text}"'
    return text


def build_front_matter(data: OrderedDict[str, str | int | float]) -> str:
    lines = [f"{key}: {format_scalar(value)}" for key, value in data.items()]
    return "\n".join(lines)


def analyze_image(image_path: Path, sample_size: int) -> dict[str, float | int]:
    with Image.open(image_path) as img:
        rgb = img.convert("RGB").resize((sample_size, sample_size))

    bins = [0.0] * 360
    dominant_sat_num = 0.0
    dominant_sat_den = 0.0

    pixels = list(rgb.getdata())
    for r, g, b in pixels:
        h, s, v = colorsys.rgb_to_hsv(r / 255.0, g / 255.0, b / 255.0)
        if s < 0.2 or v < 0.2:
            continue
        hue = int(round(h * 359.0)) % 360
        weight = s * v
        bins[hue] += weight

    total_weight = sum(bins)
    if total_weight <= 0:
        return {"dominantHue": 0, "secondaryHue": 0, "weight": 0.0, "saturation": 0.0}

    ranked = sorted(range(360), key=lambda i: bins[i], reverse=True)
    dominant_hue = ranked[0]
    secondary_hue = ranked[1] if len(ranked) > 1 else dominant_hue

    for hue in ranked[1:]:
        d = abs(hue - dominant_hue)
        if min(d, 360 - d) >= 15:
            secondary_hue = hue
            break

    for r, g, b in pixels:
        h, s, v = colorsys.rgb_to_hsv(r / 255.0, g / 255.0, b / 255.0)
        if s < 0.2 or v < 0.2:
            continue
        hue = int(round(h * 359.0)) % 360
        d = abs(hue - dominant_hue)
        if min(d, 360 - d) <= 12:
            w = s * v
            dominant_sat_den += w
            dominant_sat_num += s * w

    avg_saturation = (dominant_sat_num / dominant_sat_den) if dominant_sat_den > 0 else 0.0
    return {
        "dominantHue": int(dominant_hue),
        "secondaryHue": int(secondary_hue),
        "weight": round(bins[dominant_hue] / total_weight, 4),
        "saturation": round(avg_saturation, 4),
    }


def resolve_image(repo_root: Path, image_ref: str) -> Path:
    return repo_root / image_ref.lstrip("/")


def process_markdown_file(path: Path, repo_root: Path, image_key: str, sample_size: int) -> bool:
    original_text = path.read_text(encoding="utf-8")
    front_matter_text, body = split_front_matter(original_text)
    if front_matter_text is None:
        return False

    metadata = parse_front_matter_map(front_matter_text)
    if not metadata or all(key in metadata for key in REQUIRED_KEYS):
        return False

    image_ref = strip_quotes(metadata.get(image_key, ""))
    if not image_ref:
        return False

    image_path = resolve_image(repo_root, image_ref)
    if not image_path.exists() or image_path.suffix.lower() not in {".jpg", ".jpeg", ".png", ".webp", ".gif"}:
        return False

    color_index = analyze_image(image_path, sample_size)
    for key in REQUIRED_KEYS:
        metadata[key] = color_index[key]

    updated_text = f"---\n{build_front_matter(metadata)}\n---\n{body}"
    if updated_text == original_text:
        return False

    path.write_text(updated_text, encoding="utf-8")
    return True


def main() -> None:
    args = parse_args()
    repo_root = Path(args.repo_root).resolve()
    changed = 0

    for file_path in sorted(repo_root.glob(args.content_glob)):
        if process_markdown_file(file_path, repo_root, args.image_key, args.size):
            changed += 1
            print(f"Updated color index: {file_path.relative_to(repo_root)}")

    print(f"Done. Files updated: {changed}")


if __name__ == "__main__":
    main()
