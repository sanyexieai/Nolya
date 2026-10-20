import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
function luminance(hex: string) {
  const values = hex
    .replace("#", "")
    .match(/../g)!
    .map((value) => {
      const channel = parseInt(value, 16) / 255;
      return channel <= 0.04045
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4;
    });
  return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
}
function contrast(first: string, second: string) {
  const a = luminance(first),
    b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
const tokens = Object.fromEntries(
  [...css.matchAll(/(--[\w-]+):\s*(#[0-9a-f]{6});/g)].map((m) => [m[1], m[2]]),
);
const surfaces = [
  "#ffffff",
  "#fcfaf7",
  "#f4effa",
  "#fff0f1",
  "#fbf0f4",
  "#f8f2e9",
  "#faf1e7",
  "#f4edfd",
  "#f6ede2",
  "#e5d8f4",
  "#f3dce5",
  "#f0e2ce",
];
test("semantic text palette meets WCAG AA normal-text contrast on pastel surfaces", () => {
  for (const name of [
    "--muted",
    "--text-purple",
    "--text-rose",
    "--text-earth",
    "--text-success",
    "--purple",
    "--purple-dark",
  ]) {
    assert.ok(tokens[name], name);
    for (const surface of surfaces)
      assert.ok(
        contrast(tokens[name], surface) >= 4.5,
        `${name} on ${surface}: ${contrast(tokens[name], surface).toFixed(2)}`,
      );
  }
});
test("white action labels and meaningful form outlines retain sufficient contrast", () => {
  for (const name of [
    "--purple",
    "--purple-dark",
    "--text-purple",
    "--text-earth",
    "--text-rose",
  ])
    assert.ok(contrast("#ffffff", tokens[name]) >= 4.5, name);
  for (const surface of surfaces)
    assert.ok(
      contrast("#7b6888", surface) >= 3,
      `control outline on ${surface}`,
    );
});
test("functional mobile, card, invite and helper text actually use the accessible palette", () => {
  const selectors = [
    ".site-footer",
    ".privacy-note",
    ".hero-copy > p",
    ".page-heading p",
    ".space-card p",
    ".friends-tile .eyebrow,\n.friends-tile p",
    ".today-tile .eyebrow,\n.today-tile p",
    ".link-actions button",
    ".link-actions button:last-child",
    ".mobile-nav a",
    ".mobile-nav a.active",
    "input::placeholder",
  ];
  for (const selector of selectors) {
    const start = css.indexOf(`${selector} {`);
    assert.ok(start >= 0, selector);
    const body = css.slice(start, css.indexOf("}", start));
    assert.match(
      body,
      /color: var\(--(?:muted|text-[\w-]+|purple(?:-dark)?)\)/,
      selector,
    );
  }
  assert.match(css, /height: calc\(68px \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(
    css,
    /padding-bottom: calc\(84px \+ env\(safe-area-inset-bottom\)\)/,
  );
});
