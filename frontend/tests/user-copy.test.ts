import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";

const source = new URL("../src/", import.meta.url);
test("user-facing copy avoids the removed editorial and self-narrating phrases", () => {
  const text = readdirSync(source)
    .filter((name) => /\.(tsx?|json)$/.test(name))
    .map((name) => readFileSync(new URL(name, source), "utf8"))
    .join("\n");
  for (const phrase of [
    "今天记一笔",
    "今天这一笔",
    "真实选择先收好",
    "让时间替你慢慢补完后面的故事",
    "先选一选，再慢慢发现更多面的自己",
    "换一个方向，继续发现",
    "安全地回来，继续自己的节奏",
  ])
    assert.ok(
      !text.includes(phrase),
      `Removed editorial copy reappeared: ${phrase}`,
    );
});

test("visual and copy updates do not change the questionnaire or its scored options", () => {
  const questions = readFileSync(
    new URL("../../backend/src/questions.json", source),
  );
  assert.equal(
    createHash("sha256").update(questions).digest("hex"),
    "5abb9e876010ecfb5fda73998afe3e652aeac8636a44478de34269ba455fc662",
  );
});
