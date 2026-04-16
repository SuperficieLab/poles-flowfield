#!/usr/bin/env bash
# slice-tiles.sh — slice a large image into a tile grid using vips
#
# Usage:
#   ./slice-tiles.sh <input-image> [cols] [rows] [output-dir]
#
# Examples:
#   ./slice-tiles.sh my-map.png          → 3×2 grid, tiles/ folder
#   ./slice-tiles.sh my-map.png 2 2      → 2×2 grid
#   ./slice-tiles.sh my-map.png 4 2 out  → custom output dir

set -e

INPUT="${1}"
COLS="${2:-3}"
ROWS="${3:-2}"
OUTDIR="${4:-tiles}"

if [[ -z "$INPUT" ]]; then
  echo "Usage: $0 <input-image> [cols] [rows] [output-dir]"
  exit 1
fi

if [[ ! -f "$INPUT" ]]; then
  echo "Error: file not found: $INPUT"
  exit 1
fi

# Read image dimensions
IW=$(vipsheader -f width  "$INPUT")
IH=$(vipsheader -f height "$INPUT")

TW=$(( IW / COLS ))
TH=$(( IH / ROWS ))

echo "Image:  ${IW}×${IH}px"
echo "Grid:   ${COLS}×${ROWS} → tiles of ${TW}×${TH}px"
echo "Output: ${OUTDIR}/"
echo ""

mkdir -p "$OUTDIR"

for ((row=0; row<ROWS; row++)); do
  for ((col=0; col<COLS; col++)); do
    X=$(( col * TW ))
    Y=$(( row * TH ))

    # Last column/row gets any remainder pixels
    W=$(( col == COLS-1 ? IW - X : TW ))
    H=$(( row == ROWS-1 ? IH - Y : TH ))

    OUT="${OUTDIR}/tile_${row}_${col}.png"
    echo "  tile_${row}_${col}.png  (${W}×${H} @ ${X},${Y})"
    vips crop "$INPUT" "$OUT" $X $Y $W $H
  done
done

echo ""
echo "Done. ${ROWS}×${COLS} tiles written to ${OUTDIR}/"
