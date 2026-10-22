import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
const account = readFileSync(
  new URL("../src/Account.tsx", import.meta.url),
  "utf8",
);
const support = readFileSync(
  new URL("../src/design-support.css", import.meta.url),
  "utf8",
);
test("Guest login/registration use original decorative scenery without changing authenticated settings", () => {
  assert.ok(account.includes('!loading && user?.kind !== "registered"'));
  assert.ok(account.includes('className="account-auth-photo"'));
  assert.ok(account.includes('src="/design/ambassador-outdoor.jpg"'));
  assert.ok(
    existsSync(
      new URL("../public/design/ambassador-outdoor.jpg", import.meta.url),
    ),
  );
  assert.ok(
    !account
      .slice(account.indexOf("export function SpacePage"))
      .includes("account-auth"),
  );
  assert.match(
    support,
    /\.account-auth-scene \.account-card \{[^}]*background: #fff/,
  );
  assert.match(support, /\.account-auth-caption \{[^}]*background: #fffaf6/);
  assert.match(
    support,
    /\.account-auth-scene \.account-card input \{[^}]*font-size: 16px/,
  );
});
test("Smaller home typography is restricted to mobile and leaves artwork and touch targets intact", () => {
  assert.match(
    support,
    /@media \(max-width: 800px\) \{\s*\.home-hero \.hero-copy h1 \{\s*font-size: clamp\(27px, 7vw, 47px\)/,
  );
  assert.ok(!support.includes(".hero-actions"));
  assert.ok(!support.includes(".home-v2-scene"));
  assert.ok(!support.includes("overflow-x: hidden"));
});
