import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
const source = (name: string) =>
  readFileSync(new URL("../src/" + name, import.meta.url), "utf8");
test("supplied identity artwork is live on all layouts and utility routes", () => {
  assert.match(source("ui.tsx"), /src="\/design\/brand-wordmark.png"/);
  assert.match(source("ui.tsx"), /src="\/design\/brand-symbol.png"/);
  for (const name of [
    "Account.tsx",
    "Security.tsx",
    "Help.tsx",
    "History.tsx",
    "main.tsx",
  ])
    assert.match(source(name), /<BrandCompanion/, name);
  for (const asset of ["brand-symbol.png", "brand-wordmark.png"])
    assert(existsSync(new URL("../public/design/" + asset, import.meta.url)));
});
