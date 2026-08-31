#!/usr/bin/env python3
"""Builds src/app/favicon.ico from assets/brand/reddie-head.png.

    python3 scripts/generate-favicon.py

Separate from generate-icons.mjs because an .ico is not one image: it is a
container, and the small entries need treatment the large ones must not get.
At 16px the eyes and smile are a few pixels each and melt into one dark
smudge without sharpening, while sharpening a 128px entry only adds crunch.

Pillow's own .ico writer resizes from a single base, which would make that
per-size treatment impossible — so the container is assembled by hand. It is
a header, one 16-byte directory entry per size, then the PNGs back to back.
"""
import io
import struct

from PIL import Image, ImageFilter

SRC = "assets/brand/reddie-head.png"
OUT = "src/app/favicon.ico"
SIZES = [16, 32, 48, 64, 128]

head = Image.open(SRC).convert("RGBA")


def variant(n: int) -> Image.Image:
    im = head.resize((n, n), Image.LANCZOS)
    if n <= 48:
        # colour channels ONLY: sharpening alpha rings the transparent edge
        # and scatters dark specks around the head
        rgb = im.convert("RGB").filter(ImageFilter.UnsharpMask(0.8, 110, 2))
        im = Image.merge("RGBA", (*rgb.split(), im.getchannel("A")))
    return im


blobs = []
for n in SIZES:
    buf = io.BytesIO()
    variant(n).save(buf, format="PNG", optimize=True)
    blobs.append(buf.getvalue())

out = bytearray(struct.pack("<HHH", 0, 1, len(SIZES)))  # reserved, type=icon, count
offset = 6 + 16 * len(SIZES)
for n, blob in zip(SIZES, blobs):
    # width/height are one byte each; 256 is stored as 0
    out += struct.pack("<BBBBHHII", n % 256, n % 256, 0, 0, 1, 32, len(blob), offset)
    offset += len(blob)
for blob in blobs:
    out += blob

with open(OUT, "wb") as fh:
    fh.write(bytes(out))
print(f"wrote {OUT} ({', '.join(f'{n}px' for n in SIZES)})")
