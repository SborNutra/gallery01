#!/usr/bin/env python3
from __future__ import annotations

import argparse
import colorsys
import csv
import io
import subprocess
import tempfile
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import urlopen

from PIL import Image

REQUIRED_KEYS = ("dominantHue", "secondaryHue", "weight", "saturation")
SUPPORTED_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".webm"}
DEFAULT_SOURCE_CSV_URL = (
    "https://docs.google.com/spreadsheets/d/e/"
    "2PACX-1vRb9gChhvriuPLiHwT0yJ7zOcxHsyNNxkGQsBRMreZHFxv_oIvgOZil9mdeLiF-LvBp_onplkqZtMLR/"
    "pub?gid=0&single=true&output=csv"
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build image color index for CSV rows that reference local or remote images."
    )
    parser.add_argument("--csv-input", default=DEFAULT_SOURCE_CSV_URL)
    parser.add_argument("--csv-output", default="data/image-index.csv")
    parser.add_argument("--repo-root", default=".")
    parser.add_argument("--image-column", default="image")
    parser.add_argument("--size", type=int, default=64)
    return parser.parse_args()


def read_csv_source(source: str) -> list[dict[str, str]]:
    if source.startswith(("http://", "https://")):
        with urlopen(source) as response:  # nosec B310
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


def resolve_image_path(repo_root: Path, image_ref: str) -> Path:
    return repo_root / image_ref.lstrip("/")


def normalized_extension(image_ref: str) -> str:
    return Path(urlparse(image_ref).path).suffix.lower()


def format_float(value: float) -> str:
    if value == 0:
        return "0"
    return f"{value:.4f}".rstrip("0").rstrip(".")


def analyze_pixels(pixels: list[tuple[int, int, int]]) -> dict[str, str]:
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


def extract_webm_frame_bytes_from_local(path: Path) -> bytes:
    cmd = [
        "ffmpeg",
        "-y",
        "-i",
        str(path),
        "-frames:v",
        "1",
        "-f",
        "image2pipe",
        "-vcodec",
        "png",
        "-",
    ]
    result = subprocess.run(cmd, check=True, capture_output=True)
    return result.stdout


def extract_webm_frame_bytes_from_url(url: str) -> bytes:
    with tempfile.NamedTemporaryFile(suffix=".webm") as temp:
        with urlopen(url) as response:  # nosec B310
            temp.write(response.read())
            temp.flush()
        return extract_webm_frame_bytes_from_local(Path(temp.name))


def analyze_image_from_bytes(data: bytes, sample_size: int) -> dict[str, str]:
    with Image.open(io.BytesIO(data)) as img:
        pixels = list(img.convert("RGB").resize((sample_size, sample_size)).getdata())
    return analyze_pixels(pixels)


def analyze_image_from_local_path(image_path: Path, sample_size: int, extension: str) -> dict[str, str]:
    if extension == ".webm":
        frame = extract_webm_frame_bytes_from_local(image_path)
        return analyze_image_from_bytes(frame, sample_size)

    with Image.open(image_path) as img:
        pixels = list(img.convert("RGB").resize((sample_size, sample_size)).getdata())
    return analyze_pixels(pixels)


def analyze_image_from_url(image_url: str, sample_size: int, extension: str) -> dict[str, str]:
    if extension == ".webm":
        frame = extract_webm_frame_bytes_from_url(image_url)
        return analyze_image_from_bytes(frame, sample_size)

    with urlopen(image_url) as response:  # nosec B310
        payload = response.read()
    return analyze_image_from_bytes(payload, sample_size)


def get_row_value_case_insensitive(row: dict[str, str], key: str) -> str:
    if key in row:
        return row.get(key) or ""
    lowered = key.lower()
    for existing_key, value in row.items():
        if existing_key.lower() == lowered:
            return value or ""
    return ""


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
        image_ref = get_row_value_case_insensitive(row, image_column).strip()

        if image_ref and all((row.get(key) or "").strip() for key in REQUIRED_KEYS):
            metrics = {key: (row.get(key) or "").strip() for key in REQUIRED_KEYS}
        elif image_ref in existing_index:
            metrics = existing_index[image_ref]
        else:
            metrics = {key: (row.get(key) or "").strip() for key in REQUIRED_KEYS}
            extension = normalized_extension(image_ref)

            try:
                if image_ref.startswith(("http://", "https://")) and extension in SUPPORTED_IMAGE_EXTENSIONS:
                    metrics = analyze_image_from_url(image_ref, sample_size, extension)
                    processed_images += 1
                elif image_ref:
                    image_path = resolve_image_path(repo_root, image_ref)
                    if image_path.exists() and extension in SUPPORTED_IMAGE_EXTENSIONS:
                        metrics = analyze_image_from_local_path(image_path, sample_size, extension)
                        processed_images += 1
            except Exception:
                pass

        row_copy[image_column] = image_ref
        row_copy.update(metrics)
        output_rows.append(row_copy)

    return output_rows, processed_images


def write_csv(path: Path, rows: list[dict[str, str]], image_column: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)

    headers: list[str] = []
    for row in rows:
        for key in row.keys():
            if key not in headers:
                headers.append(key)

    if image_column not in headers:
        headers.append(image_column)

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
    write_csv(output_path, output_rows, args.image_column)
    after = output_path.read_text(encoding="utf-8")

    print(f"Rows: {len(output_rows)}")
    print(f"Images processed in this run: {processed_images}")
    print("Output changed." if before != after else "Output unchanged.")


if __name__ == "__main__":
    main()
