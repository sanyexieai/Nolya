import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import {
  renderSharePoster,
  loadShareArtwork,
  shareArtwork,
  shareTitle,
  shareContextLabel,
  posterPhotoLayout,
  coverSourceRect,
  invitationShareKind,
  checkedShareUrl,
  isLocalShareUrl,
  copyPayload,
  wrapPosterText,
  sharePlatforms,
  defaultShareText,
} from "../src/share-core.ts";
test("only HTTP(S) credential-free share links are accepted", () => {
  for (const value of [
    "javascript:alert(1)",
    "data:text/plain,secret",
    "https://user:password@example.com",
    "not a URL",
  ])
    assert.throws(() => checkedShareUrl(value));
  assert.equal(
    checkedShareUrl("https://nolya.test/friend/example").hostname,
    "nolya.test",
  );
  for (const host of [
    "localhost",
    "127.0.0.1",
    "10.0.0.2",
    "192.168.1.2",
    "172.16.0.2",
    "[::1]",
  ])
    assert.ok(isLocalShareUrl(`http://${host}/`));
  assert.equal(isLocalShareUrl("https://nolya.test/"), false);
});
test("copy preserves full Unicode text and wraps without splitting surrogate pairs", () => {
  assert.deepEqual(
    wrapPosterText("你😀好\n再见", (x) => Array.from(x).length, 2),
    ["你😀", "好", "再见"],
  );
  assert.equal(
    copyPayload("  发现😀  ", "https://nolya.test/"),
    "发现😀\nhttps://nolya.test/",
  );
  assert.equal(sharePlatforms.find((x) => x.id === "moments")?.height, 1080);
  assert.equal(sharePlatforms.find((x) => x.id === "douyin")?.height, 1920);
  assert.ok(!defaultShareText("friend").includes("答案是"));
});
let dir: string;
let harness: typeof import("./share-harness.tsx");
const dom = new JSDOM("<div id='root'></div>", { url: "https://nolya.test/" });
const saved = new Map<string, PropertyDescriptor | undefined>();
const canvasRects: number[][] = [];
const drawnImages: unknown[][] = [];
let imageFailure = false;
let decodedImages = 0;
let decodeFailure = false;
let pendingDecode: Promise<void> | undefined;
before(async () => {
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      value,
      writable: true,
      configurable: true,
    });
  }
  Object.defineProperty(dom.window.HTMLImageElement.prototype, "naturalWidth", {
    configurable: true,
    get: () => 1122,
  });
  Object.defineProperty(
    dom.window.HTMLImageElement.prototype,
    "naturalHeight",
    { configurable: true, get: () => 1402 },
  );
  Object.defineProperty(dom.window.HTMLImageElement.prototype, "decode", {
    configurable: true,
    value: async () => {
      decodedImages++;
      if (decodeFailure) throw new Error("bad image");
      if (pendingDecode) await pendingDecode;
    },
  });
  const originalSrc = Object.getOwnPropertyDescriptor(
    dom.window.HTMLImageElement.prototype,
    "src",
  )!;
  Object.defineProperty(dom.window.HTMLImageElement.prototype, "src", {
    configurable: true,
    get: originalSrc.get,
    set(value) {
      originalSrc.set!.call(this, value);
      queueMicrotask(() => {
        if (imageFailure) this.onerror?.(new dom.window.Event("error"));
        else this.onload?.(new dom.window.Event("load"));
      });
    },
  });
  const ctx = {
    createLinearGradient: () => ({ addColorStop() {} }),
    fillRect() {},
    beginPath() {},
    roundRect(...args: number[]) {
      canvasRects.push(args);
    },
    arc() {},
    fill() {},
    fillText() {},
    measureText: (x: string) => ({ width: Array.from(x).length * 32 }),
    drawImage(...args: unknown[]) {
      drawnImages.push(args);
    },
    save() {},
    restore() {},
    clip() {},
    clearRect() {},
    createImageData: (w: number, h: number) => ({
      data: new Uint8ClampedArray(w * h * 4),
    }),
    putImageData() {},
  };
  dom.window.HTMLCanvasElement.prototype.getContext = (() => ctx) as never;
  dom.window.HTMLCanvasElement.prototype.toDataURL = () =>
    "data:image/png;base64,iVBORw0KGgo=";
  dir = await mkdtemp(join(tmpdir(), "nolya-share-test-"));
  await build({
    entryPoints: [new URL("./share-harness.tsx", import.meta.url).pathname],
    outfile: join(dir, "harness.cjs"),
    bundle: true,
    platform: "node",
    format: "cjs",
    jsx: "automatic",
    logLevel: "silent",
    plugins: [
      {
        name: "native-react",
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
  });
  harness = createRequire(import.meta.url)(join(dir, "harness.cjs"));
});
after(async () => {
  for (const [key, desc] of saved) {
    if (desc) Object.defineProperty(globalThis, key, desc);
    else Reflect.deleteProperty(globalThis, key);
  }
  dom.window.close();
  await rm(dir, { recursive: true, force: true });
});
test("share panel exports PNG, handles cancel honestly, resets stale links and copy failure", async () => {
  const calls: unknown[] = [];
  Object.defineProperty(navigator, "share", {
    configurable: true,
    value: async (data: unknown) => {
      calls.push(data);
      throw new DOMException("cancel", "AbortError");
    },
  });
  Object.defineProperty(navigator, "canShare", {
    configurable: true,
    value: () => true,
  });
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: async () => {
        throw new Error("denied");
      },
    },
  });
  let root: ReturnType<typeof harness.mount>;
  await harness.act(async () => {
    root = harness.mount(
      document.getElementById("root")!,
      "https://nolya.test/friend/first",
    );
  });
  const click = async (label: string) => {
    const button = [...document.querySelectorAll("button")].find(
      (x) => x.textContent?.trim() === label,
    );
    assert.ok(button, label);
    await harness.act(async () => button.click());
  };
  assert.ok(
    document
      .querySelector("a[download]")
      ?.getAttribute("href")
      ?.startsWith("data:image/png"),
  );
  assert.equal(
    document.querySelector(".share-details")?.hasAttribute("open"),
    false,
  );
  assert.ok(
    (document.querySelector(".share-guide")?.textContent || "").length < 40,
  );
  const primary = document.querySelector(".share-export-actions")!;
  assert.match(primary.textContent!, /保存分享海报/);
  assert.match(primary.textContent!, /复制邀请链接/);
  await click("系统分享海报");
  assert.equal(calls.length, 1);
  assert.match(document.body.textContent!, /已取消系统分享/);
  assert.doesNotMatch(document.body.textContent!, /发送成功/);
  await click("复制邀请链接");
  assert.match(document.body.textContent!, /无法自动复制/);
  await harness.act(async () =>
    root.render("https://nolya.test/friend/second"),
  );
  assert.equal(
    (document.querySelector("input") as HTMLInputElement).value,
    "https://nolya.test/friend/second",
  );
  assert.doesNotMatch(document.body.textContent!, /无法自动复制/);
  await harness.act(async () => root.unmount());
});
test("reopened reverse invitations retain directed privacy and WeChat uses token link", () => {
  assert.equal(
    invitationShareKind("guess", { source_type: "reverse" }),
    "reverse",
  );
  assert.equal(invitationShareKind("guess", { is_directed: true }), "reverse");
  assert.equal(invitationShareKind("guess", { source_type: "self" }), "guess");
  assert.equal(invitationShareKind("friend"), "friend");
  const guide = sharePlatforms.find((x) => x.id === "wechat")!.guide;
  assert.match(guide, /复制下方专属链接/);
  assert.doesNotMatch(guide, /转发本页/);
});
test("directed reopened panel visibly warns private delivery and keeps special caption", async () => {
  let root: ReturnType<typeof harness.mount>;
  await harness.act(async () => {
    root = harness.mount(
      document.getElementById("root")!,
      "https://nolya.test/guess/reverse",
      invitationShareKind("guess", { source_type: "reverse" }),
    );
  });
  assert.match(document.body.textContent!, /仅原邀请人可以参与/);
  assert.match(document.body.textContent!, /请私发，不建议发布到公开平台/);
  assert.match(
    (document.querySelector("textarea") as HTMLTextAreaElement).value,
    /给原邀请人的反向邀请/,
  );
  await harness.act(async () => root.unmount());
});

test("every poster format draws decoded same-origin original photo without moving QR", async () => {
  for (const kind of [
    "friend",
    "guess",
    "reverse",
    "self",
    "mirror",
  ] as const) {
    for (const platform of ["moments", "wechat", "douyin"] as const) {
      drawnImages.length = 0;
      const before = decodedImages;
      await renderSharePoster(
        kind,
        "https://nolya.test/friend/public",
        "A short caption",
        platform,
      );
      assert.ok(decodedImages > before);
      const [photo, qr] = drawnImages;
      assert.ok(photo[0] instanceof dom.window.HTMLImageElement);
      assert.equal(
        (photo[0] as HTMLImageElement).getAttribute("src"),
        `https://nolya.test${shareArtwork[kind]}`,
      );
      const height = sharePlatforms.find((x) => x.id === platform)!.height;
      const box = posterPhotoLayout(height);
      assert.deepEqual(photo.slice(5), [box.x, box.y, box.width, box.height]);
      assert.deepEqual(qr.slice(1), [400, height - 445, 280, 280]);
      assert.ok(box.y + box.height < height - 445);
    }
  }
});
test("photo failures reject rather than exporting a blank poster, and the next load recovers", async () => {
  imageFailure = true;
  await assert.rejects(loadShareArtwork("friend"), /加载失败/);
  imageFailure = false;
  assert.ok(await loadShareArtwork("friend"));
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(loadShareArtwork("friend", controller.signal), {
    name: "AbortError",
  });
});
test("cover crop keeps original proportions and uses bounded top-biased source pixels", () => {
  const crop = coverSourceRect(1122, 1402, 880, 480);
  assert.equal(crop.width, 1122);
  assert.equal(crop.y, (1402 - crop.height) * 0.28);
  assert.ok(crop.y >= 0 && crop.y + crop.height <= 1402);
});

test("image decoding must finish before a PNG can be exported and abort cancels pending renders", async () => {
  let release!: () => void;
  pendingDecode = new Promise<void>((resolve) => {
    release = resolve;
  });
  const controller = new AbortController();
  let finished = false;
  const rendering = renderSharePoster(
    "guess",
    "https://nolya.test/guess/token",
    "hello",
    "moments",
    controller.signal,
  );
  void rendering.then(
    () => {
      finished = true;
    },
    () => {},
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(finished, false);
  controller.abort();
  await assert.rejects(rendering, { name: "AbortError" });
  release();
  pendingDecode = undefined;
  decodeFailure = true;
  await assert.rejects(loadShareArtwork("guess"), /无法解码/);
  decodeFailure = false;
  assert.ok(await loadShareArtwork("guess"));
});

test("all five concise square poster titles fit without orphan characters", () => {
  const measure = (value: string) =>
    Array.from(value).reduce(
      (sum, char) =>
        sum + (/\s/.test(char) ? 16 : /[0-9]/.test(char) ? 35 : 50),
      0,
    );
  for (const kind of [
    "friend",
    "guess",
    "reverse",
    "self",
    "mirror",
  ] as const) {
    assert.equal(
      wrapPosterText(shareTitle(kind), measure, 450).length,
      1,
      kind,
    );
  }
});

test("poster header describes only the current sharing context", () => {
  assert.deepEqual(
    ["friend", "guess", "reverse", "self", "mirror"].map((kind) =>
      shareContextLabel(kind as keyof typeof shareArtwork),
    ),
    ["朋友反馈邀请", "猜答案邀请", "定向反向邀请", "自我评估", "镜像对比"],
  );
});
