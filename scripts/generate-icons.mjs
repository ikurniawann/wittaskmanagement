// Regenerates the icon set from the brand mark.
//
//   node scripts/generate-icons.mjs
//
// The source is assets/brand/reddie-head.png — the Reddie head, already
// cropped square and cut out of its backdrop. Everything below is derived, so
// changing the mark means replacing that one file and re-running this.
//
// It used to draw an "RVC" monogram from a hand-coded 5x7 bitmap. That is gone
// (Owner 2026-08-31): the mark is now a rendered character, which no amount of
// zlib and bit-twiddling is going to reproduce.
import sharp from "sharp";
import { writeFileSync } from "node:fs";

const SRC = "assets/brand/reddie-head.png";

/** Square canvas, mark centred at `coverage` of the width. */
async function icon(size, { coverage = 1, background = null } = {}) {
  const inner = Math.round(size * coverage);
  const mark = await sharp(SRC).resize(inner, inner, { fit: "contain" }).toBuffer();
  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: background ?? { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: mark, gravity: "centre" }])
    .png()
    .toBuffer();
}

const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };

const targets = [
  // tab + PWA: transparent, full bleed
  ["public/icon-192.png", 192, {}],
  ["public/icon-512.png", 512, {}],
  // iOS composites a transparent icon onto BLACK, so this one is opaque
  ["public/apple-touch-icon.png", 180, { coverage: 0.92, background: WHITE }],
  // maskable: the OS crops it to a circle/squircle, so the mark stays inside
  // the 80% safe zone and the background is full bleed
  ["public/icon-maskable-512.png", 512, { coverage: 0.68, background: WHITE }],
];

for (const [path, size, opts] of targets) {
  writeFileSync(path, await icon(size, opts));
  console.log(`wrote ${path} (${size}px)`);
}

console.log(
  "\nfavicon.ico is NOT written here — it is a multi-size container whose\n" +
    "small sizes are sharpened individually; see scripts/generate-favicon.py",
);
