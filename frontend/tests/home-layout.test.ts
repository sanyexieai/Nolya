import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Geometry regression for the decorative rotated boxes, not a substitute for
// hosted browser layout validation. No clipping is used to mask overflow.
test("mobile hero orbit transformed bounds remain inside phone viewports", () => {
  const css = readFileSync(
    new URL("../src/styles.css", import.meta.url),
    "utf8",
  );
  const mobile = css.slice(css.indexOf("@media (max-width: 620px)"));
  for (const [selector, degrees] of [
    [".hero-art .art-orbit", -28],
    [".hero-art .orbit-two", 37],
  ] as const) {
    const start = mobile.indexOf(`${selector} {`);
    assert.ok(start >= 0, `${selector} has a mobile size override`);
    const rule = mobile.slice(start, mobile.indexOf("}", start));
    const percentage = (property: string) => {
      const match = rule.match(new RegExp(`${property}:\\s*([\\d.]+)%`));
      assert.ok(match, `${selector} ${property}`);
      return Number(match[1]) / 100;
    };
    for (const viewport of [320, 360, 370, 390, 430, 620]) {
      const artworkWidth = Math.min(
        400,
        viewport - (viewport <= 370 ? 30 : 36),
      );
      const artworkHeight = viewport <= 370 ? 330 : 360;
      const width = artworkWidth * percentage("width");
      const height = artworkHeight * percentage("height");
      const angle = (Math.abs(degrees) * Math.PI) / 180;
      const rotatedWidth = width * Math.cos(angle) + height * Math.sin(angle);
      const left =
        (viewport - artworkWidth) / 2 +
        artworkWidth * percentage("left") +
        (width - rotatedWidth) / 2;
      assert.ok(left >= 0, `${selector} left overflow at ${viewport}px`);
      assert.ok(
        left + rotatedWidth <= viewport,
        `${selector} right overflow at ${viewport}px`,
      );
    }
  }
});
