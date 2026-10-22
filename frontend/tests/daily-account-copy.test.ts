import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (name: string) =>
  readFileSync(new URL(`../src/${name}`, import.meta.url), "utf8");
const daily = read("Daily.tsx");
const account = read("Account.tsx");
const css = read("design-daily-space.css");

test("Daily, journal, space, and account copy describe user actions rather than editorial thoughts", () => {
  for (const source of [daily, account]) {
    assert.doesNotMatch(
      source,
      /今天记一笔|今天这一笔|真实的你|生活切片|时间切片|慢慢发现|慢慢拼出|留给以后的自己|留给未来|你的故事|小选择|每一种选择都很珍贵|选择已收好/,
    );
  }
  for (const label of [
    "今日答题",
    "提交答案",
    "答案已保存",
    "答题记录",
    "加载更早记录",
  ])
    assert.ok(daily.includes(label), label);
  for (const label of [
    "注册账户",
    "登录账户",
    "管理昵称、账户安全",
    "我的竞猜邀请",
  ])
    assert.ok(account.includes(label), label);
});

test("Copy cleanup preserves submitted choices, real statistics, history, and auth security", () => {
  for (const marker of [
    "pulse.question.prompt",
    "pulse.question.choice_a",
    "pulse.question.choice_b",
    "pulse.answer.choice",
    'crowd.mode === "percentage"',
    "crowd.a_percent !== null",
    "crowd.b_percent !== null",
    "pulse.saved_count",
    "entry.share_eligible",
    "solo.data.required_days",
    "solo.data.self_comparison.text",
  ])
    assert.ok(daily.includes(marker), marker);
  for (const marker of [
    'mergeConfirm !== "MERGE"',
    'deleteConfirm !== "DELETE"',
    "mergePreview.conflicts.length",
    "合并可能已经完成",
    "不要重复提交或切换账户",
    "不会跳过或丢弃记录",
    "此操作不可恢复",
    "space.capabilities?.can_register",
    "/design/ambassador-outdoor.jpg",
    'className="account-auth-photo"',
  ])
    assert.ok(account.includes(marker), marker);
});

test("Page15 responsive photo windows exclude baked motivational captions and screenshot UI", () => {
  const cases = [
    {
      crop: [245, 240, 650, 700],
      excluded: [
        [35, 95, 240, 235],
        [95, 780, 380, 900],
        [730, 80, 1536, 1024],
      ],
      rules: [
        "aspect-ratio: 405 / 460",
        "width: 379.259259%",
        "left: -60.493827%",
        "top: -52.173913%",
      ],
    },
    {
      crop: [315, 230, 690, 605],
      excluded: [
        [40, 195, 305, 360],
        [695, 575, 930, 725],
        [0, 738, 941, 1672],
      ],
      rules: [
        "aspect-ratio: 375 / 375",
        "width: 250.933333%",
        "left: -84%",
        "top: -61.333333%",
      ],
    },
  ];
  for (const { crop, excluded, rules } of cases) {
    for (const area of excluded)
      assert.ok(
        crop[2] <= area[0] ||
          crop[0] >= area[2] ||
          crop[3] <= area[1] ||
          crop[1] >= area[3],
      );
    for (const rule of rules) assert.ok(css.includes(rule), rule);
  }
  assert.match(css, /\.pulse-question-art img \{[^}]*height: auto/s);
  assert.ok(daily.includes("daily-question-desktop-reference.png"));
  assert.ok(daily.includes("daily-question-mobile-reference.png"));
});
