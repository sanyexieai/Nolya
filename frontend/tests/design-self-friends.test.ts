import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
const self = readFileSync(new URL("../src/Self.tsx", import.meta.url), "utf8");
const friends = readFileSync(
  new URL("../src/Friends.tsx", import.meta.url),
  "utf8",
);
const css = readFileSync(
  new URL("../src/design-self-friends.css", import.meta.url),
  "utf8",
);
test("Page02 and03 use source photography, never fixed result screenshots", () => {
  assert.ok(self.includes("self-question-portrait.jpg"));
  assert.ok(self.includes("ambassador-cafe.jpg"));
  assert.ok(self.includes("ambassador-outdoor.jpg"));
  assert.ok(self.includes("self-result-mobile.jpg"));
  assert.ok(!self.includes("result-petal"));
  assert.ok(!self.includes("side-art-circle"));
  assert.ok(self.includes("{result.summary}"));
  assert.ok(self.includes("result.observations.map"));
  assert.ok(self.includes("answers[question.id]"));
});
test("Page05/06 retain real consent and questions with separate scene art", () => {
  for (const file of [
    "friend-landing-desktop.png",
    "friend-landing-mobile.png",
    "friend-question-portrait.png",
  ])
    assert.ok(friends.includes(file));
  assert.ok(friends.includes("checked={consent}"));
  assert.ok(friends.includes("disabled={!consent}"));
  assert.ok(friends.includes("context.data?.privacy_notice"));
  assert.ok(friends.includes("session.questions.map"));
  assert.ok(friends.includes("question={q}"));
  assert.ok(!friends.includes("friend-hearts"));
});
test("Page07/08 visuals follow real mirror state without generating observations", () => {
  for (const file of [
    "first-mirror-cafe.jpg",
    "full-mirror-main.jpg",
    "full-mirror-glance.jpg",
    "full-mirror-rest.jpg",
  ])
    assert.ok(friends.includes(file));
  assert.ok(friends.includes('mirror?.state === "full"'));
  assert.ok(friends.includes("mirror.comparisons.map"));
  assert.ok(friends.includes("mirror.insights.map"));
  assert.ok(friends.includes("mirror.identity_notice"));
  assert.ok(friends.includes("full-mirror-mobile.jpg"));
  assert.ok(friends.includes("c.sample_size"));
});
test("Page02–08 supplied art exists and question controls stay primary on narrow phones", () => {
  for (const file of [
    "self-question-portrait.jpg",
    "friend-landing-desktop.png",
    "friend-landing-mobile.png",
    "friend-question-portrait.png",
    "first-mirror-cafe.jpg",
    "full-mirror-main.jpg",
    "full-mirror-glance.jpg",
    "full-mirror-rest.jpg",
  ])
    assert.ok(
      existsSync(new URL(`../public/design/${file}`, import.meta.url)),
      file,
    );
  assert.match(css, /\.design-friend-question-aside\s*\{\s*display: none/);
  assert.match(css, /\.design-self-question\.flow-page\s*\{\s*display: flex/);
  assert.match(
    css,
    /\.design-mirror-content \.comparison-card\s*\{\s*grid-template-columns: 1fr/,
  );
});

test("Page03 intrinsic image dimensions scale proportionally inside constrained grid", () => {
  assert.match(css, /\.design-result-portrait \{[^}]*min-width: 0/);
  assert.match(css, /\.design-result-portrait picture \{[^}]*display: block/);
  assert.match(css, /\.design-result-main \{[^}]*height: auto/);
  assert.match(css, /\.design-result-inset \{[^}]*height: auto/);
  assert.ok(!css.includes("overflow-x: hidden"));
});

test("Page02 and05 never retain intrinsic desktop heights after responsive width scaling", () => {
  assert.match(css, /\.design-self-portrait img \{[^}]*height: auto/);
  assert.match(css, /\.design-self-portrait img \{[^}]*max-height: 560px/);
  assert.match(css, /\.design-friend-landing-photo img \{[^}]*height: auto/);
});
