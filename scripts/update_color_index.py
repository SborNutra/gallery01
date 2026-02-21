#!/usr/bin/env python3
from __future__ import annotations

import argparse
import colorsys
import csv
import io
from pathlib import Path
from urllib.request import urlopen

from PIL import Image

REQUIRED_KEYS = ("dominantHue", "secondaryHue", "weight", "saturation")
SUPPORTED_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build image color index for CSV rows that reference local images."
    )
    parser.add_argument(
        "--csv-input",
        required=True,
        help="Source CSV path or URL (for example a published Google Sheets CSV URL).",
    )
    parser.add_argument(
        "--csv-output",
        default="data/image-index.csv",
        help="Output CSV file path committed to the repository.",
    )
    parser.add_argument("--repo-root", default=".")
    parser.add_argument("--image-column", default="image")
    parser.add_argument("--size", type=int, default=64)
    return parser.parse_args()


def read_csv_source(source: str) -> list[dict[str, str]]:
    if source.startswith("http://") or source.startswith("https://"):
        with urlopen(source) as response:  # nosec B310 - trusted user-provided CSV source
            text = response.read().decode("utf-8")
    else:
        text = Path(source).read_text(encoding="utf-8")

    return list(csv.DictReader(io.StringIO(text)))


def read_existing_index(path: Path, image_column: str) -> dict[str, dict[str, str]]:
    if not path.exists():
        return {}

    rows = list(csv.DictReader(path.read_text(encoding="utf-8", errors="ignore").splitlines()))
    indexed: dict[str, dict[str, str]] = {}
    for row in rows:
        image = (row.get(image_column) or "").strip()
        if image and all((row.get(key) or "").strip() for key in REQUIRED_KEYS):
            indexed[image] = {key: row[key].strip() for key in REQUIRED_KEYS}
    return indexed


def resolve_image(repo_root: Path, image_ref: str) -> Path:
    return repo_root / image_ref.lstrip("/")


def format_float(value: float) -> str:
    if value == 0:
        return "0"
    return f"{value:.4f}".rstrip("0").rstrip(".")


def analyze_image(image_path: Path, sample_size: int) -> dict[str, str]:
    with Image.open(image_path) as img:
        pixels = list(img.convert("RGB").resize((sample_size, sample_size)).getdata())

    bins = [0.0] * 360

    for r, g, b in pixels:
        h, s, v = colorsys.rgb_to_hsv(r / 255.0, g / 255.0, b / 255.0)
        if s < 0.2 or v < 0.2:
            continue
        bins[int(round(h * 359.0)) % 360] += s * v

    total_weight = sum(bins)
    if total_weight <= 0:
        return {"dominantHue": "0", "secondaryHue": "0", "weight": "0", "saturation": "0"}

    ranked = sorted(range(360), key=lambda hue: bins[hue], reverse=True)
    dominant_hue = ranked[0]
    secondary_hue = ranked[1] if len(ranked) > 1 else dominant_hue

    for hue in ranked[1:]:
        distance = abs(hue - dominant_hue)
        if min(distance, 360 - distance) >= 15:
            secondary_hue = hue
            break

    sat_num = 0.0
    sat_den = 0.0
    for r, g, b in pixels:
        h, s, v = colorsys.rgb_to_hsv(r / 255.0, g / 255.0, b / 255.0)
        if s < 0.2 or v < 0.2:
            continue
        hue = int(round(h * 359.0)) % 360
        distance = abs(hue - dominant_hue)
        if min(distance, 360 - distance) <= 12:
            w = s * v
            sat_num += s * w
            sat_den += w

    avg_saturation = sat_num / sat_den if sat_den > 0 else 0.0
    dominant_weight = bins[dominant_hue] / total_weight

    return {
        "dominantHue": str(int(dominant_hue)),
        "secondaryHue": str(int(secondary_hue)),
        "weight": format_float(dominant_weight),
        "saturation": format_float(avg_saturation),
    }


def build_output_rows(
    rows: list[dict[str, str]],
    image_column: str,
    repo_root: Path,
    sample_size: int,
    existing_index: dict[str, dict[str, str]],
) -> tuple[list[dict[str, str]], int]:
    processed_images = 0
    output_rows: list[dict[str, str]] = []

    for row in rows:
        row_copy = dict(row)
        image_ref = (row.get(image_column) or "").strip()

        if image_ref and all((row.get(key) or "").strip() for key in REQUIRED_KEYS):
            metrics = {key: (row.get(key) or "").strip() for key in REQUIRED_KEYS}
        elif image_ref in existing_index:
            metrics = existing_index[image_ref]
        else:
            image_path = resolve_image(repo_root, image_ref) if image_ref else None
            if (
                image_path
                and image_path.exists()
                and image_path.suffix.lower() in SUPPORTED_IMAGE_EXTENSIONS
            ):
                metrics = analyze_image(image_path, sample_size)
                processed_images += 1
            else:
                metrics = {key: (row.get(key) or "").strip() for key in REQUIRED_KEYS}

        row_copy.update(metrics)
        output_rows.append(row_copy)

    return output_rows, processed_images


def write_csv(path: Path, rows: list[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)

    headers: list[str] = []
    for row in rows:
        for key in row.keys():
            if key not in headers:
                headers.append(key)

    for key in REQUIRED_KEYS:
        if key not in headers:
            headers.append(key)

    with path.open("w", encoding="utf-8", newline="") as file_obj:
        writer = csv.DictWriter(file_obj, fieldnames=headers)
        writer.writeheader()
        for row in rows:
            writer.writerow(row)


def main() -> None:
    args = parse_args()
    repo_root = Path(args.repo_root).resolve()
    output_path = (repo_root / args.csv_output).resolve()

    rows = read_csv_source(args.csv_input)
    existing_index = read_existing_index(output_path, args.image_column)
    output_rows, processed_images = build_output_rows(
        rows=rows,
        image_column=args.image_column,
        repo_root=repo_root,
        sample_size=args.size,
        existing_index=existing_index,
    )

    before = output_path.read_text(encoding="utf-8") if output_path.exists() else ""
    write_csv(output_path, output_rows)
    after = output_path.read_text(encoding="utf-8")

    print(f"Rows: {len(output_rows)}")
    print(f"Images processed in this run: {processed_images}")
    print("Output changed." if before != after else "Output unchanged.")


if __name__ == "__main__":
    main()
