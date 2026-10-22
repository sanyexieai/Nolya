import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
const source = readFileSync(
  new URL("../src/Guess.tsx", import.meta.url),
  "utf8",
);
const styles = readFileSync(
  new URL("../src/design-guess.css", import.meta.url),
  "utf8",
);
test("Page10–14 use distinct supplied photographic scenes and live question/result data", () => {
  for (const file of [
    "reveal-outdoor.png",
    "reverse-start-outdoor.png",
    "reverse-ready-reference.png",
    "reverse-choice-reference.png",
    "reverse-reveal-reference.png",
  ]) {
    assert.ok(existsSync(new URL(`../public/design/${file}`, import.meta.url)));
    assert.ok(source.includes(file));
  }
  assert.match(source, /data-design-page="11"/);
  assert.match(source, /data-design-page="12"/);
  assert.match(source, /isReverse \? "14" : "10"/);
  assert.match(source, /isReverse \? "13" : "09-choice"/);
  assert.match(source, /result.guessed_choice/);
  assert.match(source, /result.actual_choice/);
  assert.match(source, /context\?\.is_directed/);
  assert.match(source, /链接创建成功不代表消息已经送达/);
  assert.doesNotMatch(source, /title="已发给 TA/);
});
test("mockup art windows exclude fixed answers and success labels and remain clipped responsively", () => {
  assert.match(source, /box=\{\[125, 245, 690, 610\]\}/);
  assert.match(source, /box=\{\[963, 230, 1490, 748\]\}/);
  assert.match(source, /box=\{\[947, 205, 1370, 700\]\}/);
  assert.match(styles, /\.guess-photo-window\s*\{[^}]*overflow: hidden/s);
  assert.match(styles, /minmax\(0, 1fr\)/);
  assert.match(source, /kind="reverse"/);
  assert.match(source, /disabled=\{!ownChoice\}/);
  assert.match(source, /disabled=\{!choice\}/);
});
