import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const page = (name: string) =>
  readFileSync(new URL(`../src/${name}`, import.meta.url), "utf8");
test("Core page copy describes actions and results instead of imagined emotions or self narration", () => {
  const sources = [
    "Home.tsx",
    "Self.tsx",
    "Friends.tsx",
    "Guess.tsx",
    "home.zh-CN.json",
  ]
    .map(page)
    .join("\n");
  for (const phrase of [
    "今天记一笔",
    "慢慢发现",
    "轻轻放在一起",
    "好好收起来",
    "一个更真实的你",
    "让了解慢慢发生",
    "小小的开心事",
    "今天再留一个小选择",
    "真正有趣的，不只是答对",
  ])
    assert.ok(!sources.includes(phrase), phrase);
  assert.ok(page("Self.tsx").includes("提交并查看结果"));
  assert.ok(page("Friends.tsx").includes("创建朋友邀请"));
  assert.ok(page("Guess.tsx").includes("你的猜测与 TA 的答案不同"));
});
test("Copy cleanup preserves live question/options and uncertainty, never replaces scoring", () => {
  assert.ok(page("Self.tsx").includes("question.prompt"));
  assert.ok(page("Friends.tsx").includes("mirror.comparisons.map"));
  assert.ok(page("Friends.tsx").includes("mirror.identity_notice"));
  assert.ok(page("Guess.tsx").includes("result.correct"));
  assert.ok(
    page("Guess.tsx").includes("当前互动次数较少，不代表你们整体的了解程度"),
  );
  assert.ok(page("Self.tsx").includes("这不是心理诊断"));
});
