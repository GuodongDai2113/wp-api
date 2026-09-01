import test from "node:test";
import assert from "node:assert/strict";

import sharp from "sharp";

import {
  calculateWebpDimensions,
  prepareMediaImage
} from "../build/wordpress/media/image.js";

test("WebP dimension rules match the reference plugin thresholds", () => {
  assert.deepEqual(calculateWebpDimensions(1200, 1200), { width: 800, height: 800 });
  assert.deepEqual(calculateWebpDimensions(4000, 2000), { width: 2000, height: 1000 });
  assert.deepEqual(calculateWebpDimensions(2500, 1000), { width: 2000, height: 800 });
  assert.deepEqual(calculateWebpDimensions(1672, 941), { width: 1672, height: 941 });
});

test("prepareMediaImage converts PNG to WebP and applies square resizing", async () => {
  const pngBytes = await sharp({
    create: {
      width: 900,
      height: 900,
      channels: 4,
      background: { r: 30, g: 60, b: 90, alpha: 0.4 }
    }
  }).png().toBuffer();

  const result = await prepareMediaImage(pngBytes, "square.png", "image/png");
  const metadata = await sharp(result.bytes).metadata();

  assert.equal(result.filename, "square.webp");
  assert.equal(result.contentType, "image/webp");
  assert.equal(result.convertedToWebp, true);
  assert.equal(metadata.format, "webp");
  assert.equal(metadata.width, 800);
  assert.equal(metadata.height, 800);
  assert.equal(metadata.hasAlpha, true);
});

test("prepareMediaImage leaves GIF data unchanged to preserve animation", async () => {
  const gifBytes = Buffer.from("GIF89a", "ascii");
  const result = await prepareMediaImage(gifBytes, "animation.gif", "image/gif");

  assert.equal(result.filename, "animation.gif");
  assert.equal(result.contentType, "image/gif");
  assert.equal(result.convertedToWebp, false);
  assert.strictEqual(result.bytes, gifBytes);
});

test("prepareMediaImage rejects invalid JPEG and PNG data before upload", async () => {
  await assert.rejects(
    () => prepareMediaImage(Buffer.from([0x89, 0x50, 0x4e, 0x47]), "broken.png", "image/png"),
    /Unable to compress the local image as WebP/
  );
});
