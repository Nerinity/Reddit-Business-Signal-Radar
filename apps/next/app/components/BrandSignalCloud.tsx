"use client";

import { useMemo } from "react";

type CloudBrand = {
  brand_norm: string;
  brand_display: string;
  unique_posts: number;
  avg_sentiment?: number;
};

type PlacedBrand = CloudBrand & {
  x: number;
  y: number;
  fontSize: number;
  width: number;
  height: number;
};

// Discrete size buckets read more predictably across exactly 15 items than a continuous
// formula would -- #1 is clearly the biggest, #15 clearly the smallest, with no risk of two
// adjacent ranks rendering at visually identical sizes.
const FONT_SIZE_BY_RANK = [30, 26, 23, 21, 19, 18, 17, 16, 15, 14, 13.5, 13, 12.5, 12, 11.5];
const ORCHID_SHADES = ["var(--orchid-plum)", "var(--orchid-purple)", "var(--orchid-mauve)"];

// Rough label footprint from character count + font size -- good enough for a greedy
// overlap check without measuring actual rendered text (no DOM measurement needed at
// layout time, keeps this a pure function of the input list).
function estimateSize(text: string, fontSize: number) {
  return { width: text.length * fontSize * 0.6 + 12, height: fontSize * 1.4 };
}

// Simplified TikTok music-note glyph: a stemmed circle (head) with a flag at the top of
// the stem, expressed as ~18 percentage-coordinate anchors within the container. Brands
// are assigned to anchors in rank order (largest brand takes the note's head).
const NOTE_ANCHORS: Array<{ x: number; y: number }> = [
  // head (wide oval cluster, bottom-left)
  { x: 22, y: 78 }, { x: 30, y: 84 }, { x: 16, y: 84 }, { x: 24, y: 70 }, { x: 34, y: 76 },
  // stem (vertical line rising from the head to the flag)
  { x: 40, y: 62 }, { x: 42, y: 50 }, { x: 44, y: 38 }, { x: 46, y: 26 }, { x: 48, y: 16 },
  // flag (curling out to the right from the top of the stem)
  { x: 58, y: 14 }, { x: 68, y: 18 }, { x: 74, y: 26 }, { x: 70, y: 34 }, { x: 60, y: 30 },
  // a few extra fill anchors so 15-20 brands all have a home without crowding the core shape
  { x: 12, y: 92 }, { x: 38, y: 88 }, { x: 54, y: 40 }
];

function boxesOverlap(a: PlacedBrand, b: PlacedBrand, containerWidth: number, containerHeight: number) {
  const ax = (a.x / 100) * containerWidth;
  const ay = (a.y / 100) * containerHeight;
  const bx = (b.x / 100) * containerWidth;
  const by = (b.y / 100) * containerHeight;
  return Math.abs(ax - bx) < (a.width + b.width) / 2 && Math.abs(ay - by) < (a.height + b.height) / 2;
}

// A fixed reference canvas is enough for the overlap heuristic -- the container scales
// responsively via CSS, but the *relative* spacing between anchors is what matters here.
const CANVAS_WIDTH = 520;
const CANVAS_HEIGHT = 260;

function layoutOnAnchors(brands: CloudBrand[]): PlacedBrand[] | null {
  const placed: PlacedBrand[] = brands.map((brand, index) => {
    const fontSize = FONT_SIZE_BY_RANK[index] ?? FONT_SIZE_BY_RANK[FONT_SIZE_BY_RANK.length - 1];
    const anchor = NOTE_ANCHORS[index] ?? { x: 50, y: 50 };
    const { width, height } = estimateSize(brand.brand_display, fontSize);
    return { ...brand, x: anchor.x, y: anchor.y, fontSize, width, height };
  });
  for (let i = 0; i < placed.length; i += 1) {
    for (let j = i + 1; j < placed.length; j += 1) {
      if (boxesOverlap(placed[i], placed[j], CANVAS_WIDTH, CANVAS_HEIGHT)) return null;
      const clipped = placed[j].x < 4 || placed[j].x > 96 || placed[j].y < 4 || placed[j].y > 96;
      if (clipped) return null;
    }
  }
  return placed;
}

// Fallback: a simple row-wrapping stagger, largest first, each row alternating a slight
// vertical offset so labels don't all sit on a rigid grid. Same overlap-avoidance check
// nudges any pair that still collides.
function layoutFreeform(brands: CloudBrand[]): PlacedBrand[] {
  const placed: PlacedBrand[] = [];
  const columns = 4;
  brands.forEach((brand, index) => {
    const fontSize = FONT_SIZE_BY_RANK[index] ?? FONT_SIZE_BY_RANK[FONT_SIZE_BY_RANK.length - 1];
    const { width, height } = estimateSize(brand.brand_display, fontSize);
    const col = index % columns;
    const row = Math.floor(index / columns);
    const x = 14 + col * (72 / (columns - 1)) + (row % 2 === 0 ? 0 : 6);
    const y = 16 + row * 22;
    placed.push({ ...brand, x, y: Math.min(y, 92), fontSize, width, height });
  });
  for (let i = 0; i < placed.length; i += 1) {
    for (let j = i + 1; j < placed.length; j += 1) {
      if (boxesOverlap(placed[i], placed[j], CANVAS_WIDTH, CANVAS_HEIGHT)) {
        placed[j].x = Math.min(96, placed[j].x + 8);
      }
    }
  }
  return placed;
}

export function BrandSignalCloud({ brands, onSelect }: { brands: CloudBrand[]; onSelect: (brandNorm: string) => void }) {
  const placed = useMemo(() => layoutOnAnchors(brands) || layoutFreeform(brands), [brands]);
  return (
    <div className="brandSignalCloud">
      {placed.map((brand, index) => {
        const isPositive = (brand.avg_sentiment ?? 0) >= 0.4;
        const color = isPositive ? "var(--sentiment-positive)" : ORCHID_SHADES[index % ORCHID_SHADES.length];
        return (
          <button
            key={brand.brand_norm}
            className="brandCloudItem"
            style={{ left: `${brand.x}%`, top: `${brand.y}%`, fontSize: brand.fontSize, color }}
            onClick={() => onSelect(brand.brand_norm)}
            title={`${brand.brand_display} · ${brand.unique_posts}`}
          >
            {brand.brand_display}
          </button>
        );
      })}
    </div>
  );
}
