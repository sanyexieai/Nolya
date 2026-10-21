import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const home = readFileSync(new URL("../src/Home.tsx", import.meta.url), "utf8");
const ui = readFileSync(new URL("../src/ui.tsx", import.meta.url), "utf8");
test("frozen design palette and editorial typography remain explicit", () => {
  for (const value of [
    "#6b57ff",
    "#4e3df2",
    "#eae4ff",
    "#ffb88a",
    "#171531",
    "#e8e4f2",
  ])
    assert.ok(css.includes(value));
  assert.match(css, /\.wordmark\s*\{\s*font-family: Inter/);
  for (const match of css.matchAll(/font-size: ([\d.]+)px/g))
    assert.ok(Number(match[1]) >= 13, `tiny font ${match[1]}px`);
});
test("home copy comes from supplied v2 locale, with real supplied illustrative images", () => {
  assert.ok(home.includes("copy.hero.headline"));
  assert.ok(home.includes("copy.steps.map"));
  const hero = ui.slice(ui.indexOf("export function HeroArt"));
  assert.ok(hero.includes("home-v2-reference.png"));
  assert.ok(hero.includes("非用户评价"));
  assert.ok(!hero.includes("reflection-head"));
  for (const file of [
    "home-v2-reference.png",
    "ambassador-cafe.jpg",
    "ambassador-outdoor.jpg",
    "invite-desktop.png",
    "invite-mobile.png",
  ])
    assert.ok(existsSync(new URL(`../public/design/${file}`, import.meta.url)));
});
test("new home and invitation grid tracks can shrink and stack without hiding overflow", () => {
  assert.match(
    css,
    /grid-template-columns: minmax\(0, 1\.18fr\) minmax\(0, 1fr\)/,
  );
  assert.match(css, /\.invite-photo\s*\{\s*order: -1/);
  assert.match(css, /\.hero-actions\s*\{\s*flex-direction: column/);
});
test("Page09 never renders saved choice and uses original read-only portrait composition", () => {
  const source = readFileSync(
    new URL("../src/Guess.tsx", import.meta.url),
    "utf8",
  );
  const launch = source.slice(0, source.indexOf("export function GuessPage"));
  assert.ok(!launch.includes("answer.choice"));
  assert.ok(!launch.includes("choice: e.choice"));
  assert.ok(!launch.includes("choice: a.choice"));
  assert.ok(launch.includes("guess-option-previews"));
  assert.ok(launch.includes("/design/guess-outdoor.png"));
  assert.ok(launch.includes("changeQuestion"));
  assert.ok(launch.includes("answer_id: selected.id"));
  assert.ok(
    existsSync(new URL("../public/design/guess-outdoor.png", import.meta.url)),
  );
});

test("Home uses latest v2 composite art region without obsolete portrait substitution", () => {
  const hero = ui.slice(ui.indexOf("export function HeroArt"));
  assert.ok(!hero.includes("ambassador-cafe.jpg"));
  assert.ok(!hero.includes("portrait-insert"));
  assert.match(css, /aspect-ratio: 986 \/ 675/);
  assert.match(css, /left: -60\.851927%/);
  assert.match(css, /top: -11\.111111%/);
});
