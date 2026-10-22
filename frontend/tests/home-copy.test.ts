import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { selectHomeHero } from "../src/home-copy.ts";
const copy = JSON.parse(
  readFileSync(new URL("../src/home.zh-CN.json", import.meta.url), "utf8"),
);

test("five complete concise hero sets preserve real question counts and fixed actions", () => {
  assert.equal(copy.hero.variants.length, 5);
  assert.equal(
    new Set(copy.hero.variants.map((v: { id: string }) => v.id)).size,
    5,
  );
  for (const variant of copy.hero.variants) {
    assert.ok(variant.eyebrow.length > 0);
    const lines = variant.headline.split("\n");
    assert.equal(lines.length, 3);
    assert.ok(
      lines.every((line: string) => line.length > 0 && line.length <= 8),
    );
    assert.match(variant.subheadline, /8 道/);
    assert.match(variant.subheadline, /3 道/);
    assert.doesNotMatch(
      JSON.stringify(variant),
      /诊断|治愈|准确率|真正的你|今天记一笔|我认为|我觉得/,
    );
  }
  assert.equal(copy.hero.primaryCTA, "开始回答 8 道题");
  assert.equal(copy.hero.secondaryCTA, "查看朋友反馈");
});
test("selector covers each equal interval, including bounds, with one draw and allowed repeats", () => {
  const variants = copy.hero.variants;
  for (let i = 0; i < 5; i++) {
    let draws = 0;
    assert.equal(
      selectHomeHero(variants, () => {
        draws++;
        return (i + 0.5) / 5;
      }),
      variants[i],
    );
    assert.equal(draws, 1);
  }
  assert.equal(
    selectHomeHero(variants, () => 0),
    variants[0],
  );
  assert.equal(
    selectHomeHero(variants, () => 1 - Number.EPSILON),
    variants[4],
  );
  assert.equal(
    selectHomeHero(variants, () => 0.4),
    selectHomeHero(variants, () => 0.4),
  );
  assert.throws(() => selectHomeHero([], () => 0));
  for (const sample of [-1, 1, NaN, Infinity])
    assert.throws(() => selectHomeHero(variants, () => sample), RangeError);
});
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://nolya.test/",
});
const saved = new Map<string, PropertyDescriptor | undefined>();
const originalRandom = Math.random;
let harness: typeof import("./home-harness.tsx");
let directory: string;
let sessionUser: null | {
  id: string;
  kind: string;
  username: null;
  display_name: string;
  locale: string;
  region: string;
} = null;
before(async () => {
  for (const [name, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    sessionStorage: dom.window.sessionStorage,
    IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async () => Response.json({ user: sessionUser, csrf_token: null }),
  })) {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, {
      configurable: true,
      writable: true,
      value,
    });
  }
  directory = await mkdtemp(join(tmpdir(), "nolya-home-tests-"));
  const output = await build({
    entryPoints: [fileURLToPath(new URL("home-harness.tsx", import.meta.url))],
    bundle: true,
    format: "cjs",
    platform: "node",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
    plugins: [
      {
        name: "native-test-dependencies",
        setup(builder) {
          builder.onResolve(
            {
              filter:
                /^(react(?:\/.*)?|react-dom\/.*|react-router-dom|lucide-react)$/,
            },
            (args) => ({
              path: createRequire(import.meta.url).resolve(args.path),
              external: true,
            }),
          );
        },
      },
    ],
    write: false,
  });
  const compiled = join(directory, "home-harness.cjs");
  await writeFile(compiled, output.outputFiles[0].contents);
  harness = createRequire(import.meta.url)(compiled);
});
after(async () => {
  Math.random = originalRandom;
  dom.window.close();
  for (const [name, descriptor] of saved) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
  await rm(directory, { recursive: true, force: true });
});
test("StrictMode and session rerenders stay stable; route returns, history and full remount draw anew", async () => {
  let sample = 0;
  Math.random = () => sample;
  const host = dom.window.document.createElement("div");
  dom.window.document.body.append(host);
  const id = () =>
    host.querySelector(".home-hero")?.getAttribute("data-hero-variant");
  let root: ReturnType<typeof harness.mount>;
  await harness.act(async () => {
    root = harness.mount(host);
  });
  assert.equal(id(), copy.hero.variants[0].id);
  sample = 0.9;
  sessionUser = {
    id: "guest-home",
    kind: "guest",
    username: null,
    display_name: "访客",
    locale: "zh-CN",
    region: "CN",
  };
  await harness.act(async () => {
    await harness.refresh();
  });
  assert.equal(id(), copy.hero.variants[0].id);
  assert.match(
    host.querySelector(".daily-teaser")!.textContent!,
    /查看今日问题/,
  );
  await harness.act(async () => {
    harness.go("/other");
  });
  assert.equal(id(), undefined);
  await harness.act(async () => {
    harness.go(-1);
  });
  assert.equal(id(), copy.hero.variants[4].id);
  await harness.act(async () => {
    harness.go(1);
  });
  sample = 0.5;
  await harness.act(async () => {
    harness.go("/");
  });
  assert.equal(id(), copy.hero.variants[2].id);
  // Returning can legitimately select the same set again.
  await harness.act(async () => {
    harness.go(-1);
  });
  await harness.act(async () => {
    harness.go(1);
  });
  assert.equal(id(), copy.hero.variants[2].id);
  await harness.act(async () => {
    root!.unmount();
  });
  sample = 0.3;
  await harness.act(async () => {
    root = harness.mount(host);
  });
  assert.equal(id(), copy.hero.variants[1].id);
  await harness.act(async () => {
    root!.unmount();
  });
  host.remove();
});
