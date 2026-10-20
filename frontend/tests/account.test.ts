import { after, afterEach, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import type { MergePreview, Session } from "../src/api.ts";

const guest: Session = {
  user: {
    id: "guest-one",
    kind: "guest",
    username: null,
    display_name: "访客",
    locale: "zh-CN",
    region: "CN",
  },
  csrf_token: "guest-csrf",
};
const target: Session = {
  user: {
    ...guest.user!,
    id: "existing-account",
    kind: "registered",
    username: "existing",
    display_name: "原有昵称",
  },
  csrf_token: "rotated-account-csrf",
};
const preview: MergePreview = {
  can_merge: true,
  merge_token: "preview-token-one",
  expires_at: "2026-10-20T08:05:00Z",
  target: { username: "existing", display_name: "原有昵称" },
  summary: {
    self_assessments: 1,
    pulse_answers: 2,
    friend_responses: 3,
    friend_reservations: 4,
    friend_invites: 5,
    guesses: 6,
    guess_links: 7,
  },
  conflicts: [],
  notice: "所有记录都会完整迁移。",
};
type Call = { path: string; body: unknown; headers: Headers };
const calls: Call[] = [];
const handlers = new Map<
  string,
  (call: Call) => Response | Promise<Response>
>();
let initialSession = guest;
let root: { unmount: () => void };
let harness: typeof import("./account-harness.tsx");
let directory: string;
const originalFetch = globalThis.fetch;
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://nolya.test/account",
});
const savedGlobals = new Map<string, PropertyDescriptor | undefined>();

function errorResponse(code: string, message = code, status = 409) {
  return Response.json({ error: { code, message } }, { status });
}
function deferred() {
  let resolve!: (response: Response) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<Response>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function text() {
  return dom.window.document.body.textContent || "";
}
function input(id: string) {
  const element = dom.window.document.getElementById(id);
  assert.ok(element instanceof dom.window.HTMLInputElement, `input ${id}`);
  return element;
}
function button(label: string) {
  const element = [...dom.window.document.querySelectorAll("button")].find(
    (item) => item.textContent?.trim() === label,
  );
  assert.ok(element, `button ${label}`);
  return element;
}
async function click(label: string) {
  await harness.act(async () => button(label).click());
}
async function fill(id: string, value: string) {
  await harness.act(async () => {
    const element = input(id);
    Object.getOwnPropertyDescriptor(
      dom.window.HTMLInputElement.prototype,
      "value",
    )!.set!.call(element, value);
    element.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
}
async function submit() {
  await harness.act(async () => {
    const form = dom.window.document.querySelector("form");
    assert.ok(form);
    form.dispatchEvent(
      new dom.window.Event("submit", { bubbles: true, cancelable: true }),
    );
  });
}
function requests(path: string) {
  return calls.filter((call) => call.path === path);
}
async function prepareMerge() {
  await click("已有账户");
  await fill("username", "existing");
  await fill("password", "synthetic-password");
  await submit();
  assert.equal(requests("/auth/login").length, 1);
  assert.equal(requests("/auth/merge/preview").length, 0);
  assert.equal(harness.currentSession().user?.id, guest.user!.id);
  assert.match(text(), /访客记录尚未合并/);
}
async function showPreview() {
  await prepareMerge();
  await submit();
}

before(async () => {
  for (const name of [
    "window",
    "document",
    "navigator",
    "Element",
    "HTMLElement",
    "HTMLInputElement",
    "Event",
    "MouseEvent",
    "sessionStorage",
  ]) {
    savedGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, {
      configurable: true,
      value: dom.window[name as keyof typeof dom.window],
    });
  }
  savedGlobals.set(
    "IS_REACT_ACT_ENVIRONMENT",
    Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT"),
  );
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
    configurable: true,
    value: true,
  });
  directory = await mkdtemp(join(tmpdir(), "nolya-component-tests-"));
  const output = await build({
    entryPoints: [
      fileURLToPath(new URL("account-harness.tsx", import.meta.url)),
    ],
    bundle: true,
    format: "cjs",
    platform: "node",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
    // Keep React's native CommonJS test scheduler; bundling it creates orphaned
    // MessagePorts in act's browser fallback and prevents node:test from exiting.
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
  const compiled = join(directory, "account-harness.cjs");
  await writeFile(compiled, output.outputFiles[0].contents);
  harness = createRequire(import.meta.url)(compiled);
});
beforeEach(async () => {
  calls.length = 0;
  handlers.clear();
  initialSession = guest;
  dom.window.sessionStorage.clear();
  handlers.set("/auth/login", () => errorResponse("guest_merge_required"));
  handlers.set("/auth/merge/preview", () => Response.json(preview));
  handlers.set("/auth/merge/confirm", () => Response.json(target));
  globalThis.fetch = async (path, options) => {
    const normalized = String(path).replace("/api/v1", "");
    const call = {
      path: normalized,
      body: options?.body ? JSON.parse(options.body as string) : null,
      headers: new Headers(options?.headers),
    };
    calls.push(call);
    const handler = handlers.get(normalized);
    if (normalized === "/session" && !handler)
      return Response.json(initialSession);
    assert.ok(handler, `unexpected request ${normalized}`);
    return handler(call);
  };
  dom.window.document.body.innerHTML = '<div id="root"></div>';
  await harness.act(async () => {
    root = harness.mount(dom.window.document.getElementById("root")!);
  });
});
afterEach(async () => {
  await harness.act(async () => root.unmount());
  globalThis.fetch = originalFetch;
});
after(async () => {
  await rm(directory, { recursive: true, force: true });
  dom.window.close();
  for (const [name, descriptor] of savedGlobals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
});

test("preview is explicit, preserves guest/session, and shows every exact count and consequence", async () => {
  await showPreview();
  assert.equal(harness.currentPath(), "/account");
  assert.equal(harness.currentSession().user?.id, guest.user!.id);
  assert.equal(requests("/auth/merge/confirm").length, 0);
  const request = requests("/auth/merge/preview")[0];
  assert.deepEqual(request.body, {
    username: "existing",
    password: "synthetic-password",
  });
  assert.equal(request.headers.get("X-CSRF-Token"), "guest-csrf");
  assert.deepEqual(
    [...dom.window.document.querySelectorAll(".merge-summary dd")].map(
      (item) => item.textContent,
    ),
    ["1", "2", "3", "4", "5", "6", "7"],
  );
  assert.match(text(), /@existing/);
  assert.match(text(), /预览只验证账户，不会登录、转移或删除记录/);
  assert.match(text(), /昵称和设置保持不变/);
  assert.match(text(), /已分享的访客链接会改为显示目标账户昵称“原有昵称”/);
  assert.match(text(), /所有旧访客会话/);
  assert.match(text(), /最新结果按原始创建时间确定/);
  assert.match(text(), /不会跳过或丢弃记录/);
  assert.match(text(), /同一天的每日选择/);
  assert.equal(button("确认合并并登录").disabled, true);
  await fill("merge-confirm", "merge");
  assert.equal(button("确认合并并登录").disabled, true);
});

test("cancelling forgets the preview token and password and retains the guest", async () => {
  await showPreview();
  await fill("merge-confirm", "MERGE");
  await click("取消合并，保留访客空间");
  assert.equal(input("password").value, "");
  assert.equal(dom.window.document.getElementById("merge-confirm"), null);
  assert.equal(harness.currentSession().user?.id, guest.user!.id);
  assert.equal(requests("/auth/merge/confirm").length, 0);
  assert.equal(button("登录我的空间").disabled, false);
  await click("保存为账户");
  assert.equal(input("password").value, "");
  assert.equal(button("创建账户，保存我的选择").disabled, false);
  assert.doesNotMatch(text(), /@existing/);
});

test("same-day Pulse and all other returned conflicts block the whole merge", async () => {
  handlers.set("/auth/merge/preview", () =>
    Response.json({
      ...preview,
      can_merge: false,
      merge_token: null,
      expires_at: null,
      conflicts: [
        {
          code: "pulse_overlap",
          count: 2,
          message: "两个空间在同一天留下了每日选择",
        },
        { code: "friend_overlap", count: 1, message: "重复参与同一组朋友反馈" },
        { code: "self_guess", count: 3, message: "会变成对自己的猜测" },
      ],
    }),
  );
  await showPreview();
  assert.match(text(), /暂时无法合并/);
  assert.match(text(), /两个空间在同一天留下了每日选择（2 项）/);
  assert.match(text(), /重复参与同一组朋友反馈（1 项）/);
  assert.match(text(), /会变成对自己的猜测（3 项）/);
  assert.equal(dom.window.document.getElementById("merge-confirm"), null);
  assert.equal(requests("/auth/merge/confirm").length, 0);
  assert.equal(harness.currentSession().user?.id, guest.user!.id);
  assert.equal(button("导出访客数据").disabled, false);
});

test("failed credential preview clears the password and leaves a retryable guest form", async () => {
  handlers.set("/auth/merge/preview", () =>
    errorResponse("invalid_credentials", "用户名或密码不正确", 401),
  );
  await showPreview();
  assert.match(text(), /用户名或密码不正确/);
  assert.equal(input("password").value, "");
  assert.equal(button("验证账户并预览合并").disabled, false);
  assert.equal(harness.currentSession().user?.id, guest.user!.id);
  assert.equal(requests("/auth/merge/confirm").length, 0);
});

for (const code of ["merge_preview_stale", "merge_preview_expired"]) {
  test(`${code} discards the token and requires password plus a fresh preview`, async () => {
    handlers.set("/auth/merge/confirm", () => errorResponse(code));
    await showPreview();
    await fill("merge-confirm", "MERGE");
    await click("确认合并并登录");
    assert.match(text(), /本次合并未执行/);
    assert.match(text(), /重新输入密码/);
    assert.equal(input("password").value, "");
    assert.equal(dom.window.document.getElementById("merge-confirm"), null);
    assert.equal(requests("/auth/merge/confirm").length, 1);
    assert.equal(harness.currentSession().user?.id, guest.user!.id);
    handlers.set("/auth/merge/preview", () =>
      Response.json({ ...preview, merge_token: "fresh-preview-token" }),
    );
    handlers.set("/auth/merge/confirm", () => Response.json(target));
    await fill("password", "reauthenticated-password");
    await submit();
    assert.equal(input("merge-confirm").value, "");
    assert.equal(requests("/auth/merge/confirm").length, 1);
    await fill("merge-confirm", "MERGE");
    await click("确认合并并登录");
    assert.deepEqual(requests("/auth/merge/confirm")[1].body, {
      merge_token: "fresh-preview-token",
      confirmation: "MERGE",
    });
    assert.equal(harness.currentSession().user?.id, target.user!.id);
  });
}

test("uncertain confirm failure first reconciles the actual guest session before allowing a fresh preview", async () => {
  handlers.set("/auth/merge/confirm", async () => {
    throw new Error("synthetic disconnected response");
  });
  await showPreview();
  await fill("merge-confirm", "MERGE");
  await click("确认合并并登录");
  assert.match(text(), /已确认当前仍是访客空间/);
  assert.match(text(), /重新输入密码/);
  assert.doesNotMatch(text(), /本次合并未执行/);
  assert.equal(input("password").value, "");
  assert.equal(requests("/auth/merge/confirm").length, 1);
  assert.equal(harness.currentPath(), "/account");
  assert.equal(calls.at(-1)!.path, "/session");
});

test("a lost confirm response recovers the committed destination from the session endpoint", async () => {
  handlers.set("/auth/merge/confirm", async () => {
    handlers.set("/session", () => Response.json(target));
    throw new Error("synthetic lost confirmation response");
  });
  await showPreview();
  await fill("merge-confirm", "MERGE");
  await click("确认合并并登录");
  assert.equal(harness.currentSession().user?.id, target.user!.id);
  assert.equal(harness.currentPath(), "/space");
  assert.equal(requests("/auth/merge/confirm").length, 1);
  assert.equal(calls.at(-1)!.path, "/session");
  assert.doesNotMatch(text(), /仍是访客空间|尚未合并/);
});

test("failed session reconciliation locks all account actions until an explicit refresh succeeds", async () => {
  handlers.set("/auth/merge/confirm", async () => {
    handlers.set("/session", () =>
      errorResponse("unavailable", "暂时无法读取状态", 503),
    );
    throw new Error("synthetic lost confirmation response");
  });
  await showPreview();
  await fill("merge-confirm", "MERGE");
  await click("确认合并并登录");
  assert.match(text(), /合并可能已经完成/);
  assert.doesNotMatch(text(), /访客记录尚未合并|当前仍是访客空间/);
  assert.equal(dom.window.document.getElementById("username"), null);
  assert.equal(dom.window.document.getElementById("password"), null);
  assert.equal(dom.window.document.querySelector(".guest-data-controls"), null);
  assert.equal(button("已有账户").disabled, true);
  assert.equal(button("保存为账户").disabled, true);
  assert.equal(button("刷新账户状态").disabled, false);
  assert.equal(requests("/auth/merge/confirm").length, 1);
  handlers.set("/session", () => Response.json(target));
  await click("刷新账户状态");
  assert.equal(harness.currentSession().user?.id, target.user!.id);
  assert.equal(harness.currentPath(), "/space");
  assert.equal(requests("/auth/merge/confirm").length, 1);
});

test("successful explicit confirmation accepts only the returned session and rotates CSRF", async () => {
  await showPreview();
  dom.window.sessionStorage.setItem("nolya-self-draft", "old guest draft");
  await fill("merge-confirm", "MERGE");
  await click("确认合并并登录");
  assert.deepEqual(requests("/auth/merge/confirm")[0].body, {
    merge_token: "preview-token-one",
    confirmation: "MERGE",
  });
  assert.equal(harness.currentSession().user?.id, target.user!.id);
  assert.equal(harness.currentSession().user?.display_name, "原有昵称");
  assert.equal(harness.currentPath(), "/space");
  assert.equal(dom.window.sessionStorage.getItem("nolya-self-draft"), null);
  handlers.set("/auth/logout", () => Response.json({}));
  await harness.post("/auth/logout");
  assert.equal(
    requests("/auth/logout")[0].headers.get("X-CSRF-Token"),
    "rotated-account-csrf",
  );
});

test("pending preview locks fields, tabs, cancellation, navigation and repeated submits", async () => {
  await prepareMerge();
  const pending = deferred();
  handlers.set("/auth/merge/preview", () => pending.promise);
  await submit();
  await submit();
  assert.equal(requests("/auth/merge/preview").length, 1);
  assert.equal(input("username").disabled, true);
  assert.equal(input("password").disabled, true);
  assert.equal(button("已有账户").disabled, true);
  assert.equal(button("保存为账户").disabled, true);
  assert.equal(button("取消合并，保留访客空间").disabled, true);
  assert.equal(button("导出访客数据").disabled, true);
  await harness.act(async () => {
    dom.window.document.querySelector<HTMLAnchorElement>("a")!.click();
  });
  assert.equal(harness.currentPath(), "/account");
  await harness.act(async () => pending.resolve(Response.json(preview)));
  await click("取消合并，保留访客空间");
  assert.equal(input("password").value, "");
  await harness.act(async () => {
    dom.window.document.querySelector<HTMLAnchorElement>("a")!.click();
  });
  assert.equal(harness.currentPath(), "/other");
});

test("pending confirm is single-flight even for two same-tick clicks", async () => {
  await showPreview();
  await fill("merge-confirm", "MERGE");
  const pending = deferred();
  handlers.set("/auth/merge/confirm", () => pending.promise);
  await harness.act(async () => {
    button("确认合并并登录").click();
    button("确认合并并登录").click();
  });
  assert.equal(requests("/auth/merge/confirm").length, 1);
  assert.equal(input("merge-confirm").disabled, true);
  assert.equal(button("取消合并，保留访客空间").disabled, true);
  await harness.act(async () => pending.resolve(Response.json(target)));
  assert.equal(harness.currentPath(), "/space");
});

test("a late preview cannot affect another user identity", async () => {
  await prepareMerge();
  const pending = deferred();
  handlers.set("/auth/merge/preview", () => pending.promise);
  await submit();
  const otherGuest = {
    ...guest,
    user: { ...guest.user!, id: "different-guest" },
    csrf_token: "different-csrf",
  };
  await harness.act(async () =>
    harness.currentSession().acceptSession(otherGuest),
  );
  await harness.act(async () => pending.resolve(Response.json(preview)));
  assert.equal(harness.currentSession().user?.id, "different-guest");
  assert.equal(dom.window.document.getElementById("merge-confirm"), null);
  assert.equal(input("password").value, "");
  assert.equal(button("登录我的空间").disabled, false);
});

test("a late confirmation cannot replace a newer user identity", async () => {
  await showPreview();
  await fill("merge-confirm", "MERGE");
  const pending = deferred();
  handlers.set("/auth/merge/confirm", () => pending.promise);
  await click("确认合并并登录");
  await harness.act(async () =>
    harness.currentSession().acceptSession({
      ...guest,
      user: { ...guest.user!, id: "different-guest" },
      csrf_token: "different-csrf",
    }),
  );
  await harness.act(async () => pending.resolve(Response.json(target)));
  assert.equal(harness.currentSession().user?.id, "different-guest");
  assert.equal(harness.currentPath(), "/account");
  assert.equal(dom.window.document.getElementById("merge-confirm"), null);
  assert.equal(input("password").value, "");
});

test("a confirmation resolving after route unmount cannot overwrite client session state or redirect", async () => {
  await showPreview();
  await fill("merge-confirm", "MERGE");
  const pending = deferred();
  handlers.set("/auth/merge/confirm", () => pending.promise);
  await click("确认合并并登录");
  // Programmatic/history navigation can unmount; ignore late client-side effects.
  // This does not assert that a real browser's Set-Cookie or server commit stops.
  await harness.act(async () => harness.go("/other"));
  await harness.act(async () => pending.resolve(Response.json(target)));
  assert.equal(harness.currentPath(), "/other");
  assert.equal(harness.currentSession().user?.id, guest.user!.id);
});

test("changing mode after preview discards the pending token and password", async () => {
  await showPreview();
  await fill("merge-confirm", "MERGE");
  await click("保存为账户");
  assert.equal(input("password").value, "");
  assert.equal(dom.window.document.getElementById("merge-confirm"), null);
  assert.equal(requests("/auth/merge/confirm").length, 0);
  await click("已有账户");
  assert.equal(button("登录我的空间").disabled, false);
});

test("explicit guest logout followed by ordinary login remains usable", async () => {
  handlers.set("/auth/logout", () => new Response(null, { status: 204 }));
  await click("退出访客，改用已有账户");
  assert.match(text(), /可能无法再找回/);
  await click("退出访客，登录已有账户");
  assert.equal(harness.currentSession().user, null);
  assert.equal(input("password").value, "");
  assert.equal(button("登录我的空间").disabled, false);
  handlers.set("/auth/login", () => Response.json(target));
  await fill("username", "existing");
  await fill("password", "synthetic-password");
  await submit();
  assert.equal(harness.currentPath(), "/space");
  assert.equal(requests("/session/guest").length, 0);
});

test("guest data export still downloads the returned records without changing the session", async () => {
  const data = { self_assessments: [{ id: "synthetic-assessment" }] };
  handlers.set("/me/export", () => Response.json(data));
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  const originalClick = dom.window.HTMLAnchorElement.prototype.click;
  let saved: Blob | undefined;
  let download = "";
  let revoked = "";
  URL.createObjectURL = (blob) => {
    saved = blob;
    return "blob:synthetic-download";
  };
  URL.revokeObjectURL = (url) => {
    revoked = url;
  };
  dom.window.HTMLAnchorElement.prototype.click = function () {
    download = this.download;
  };
  try {
    await click("导出访客数据");
    assert.deepEqual(JSON.parse(await saved!.text()), data);
    assert.match(download, /^nolya-my-data-\d{4}-\d{2}-\d{2}\.json$/);
    assert.equal(revoked, "blob:synthetic-download");
    assert.match(text(), /数据已准备下载/);
    assert.equal(harness.currentSession().user?.id, guest.user!.id);
  } finally {
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
    dom.window.HTMLAnchorElement.prototype.click = originalClick;
  }
});

test("saving the current guest as a new account remains usable", async () => {
  handlers.set("/auth/register", () =>
    Response.json({
      ...target,
      user: { ...target.user!, id: guest.user!.id, username: "new_account" },
    }),
  );
  await fill("nickname", "新昵称");
  await fill("username", "new_account");
  await fill("password", "synthetic-long-password");
  await submit();
  assert.deepEqual(requests("/auth/register")[0].body, {
    username: "new_account",
    password: "synthetic-long-password",
    display_name: "新昵称",
  });
  assert.equal(harness.currentSession().user?.kind, "registered");
  assert.equal(harness.currentSession().user?.id, guest.user!.id);
  assert.equal(harness.currentPath(), "/space");
});

test("registration can create its first guest session without invalidating its own request", async () => {
  await harness.act(async () =>
    harness.currentSession().acceptSession({ user: null, csrf_token: null }),
  );
  handlers.set("/session/guest", () => Response.json(guest));
  handlers.set("/auth/register", () =>
    Response.json({
      ...target,
      user: { ...target.user!, id: guest.user!.id, username: "new_account" },
    }),
  );
  await fill("username", "new_account");
  await fill("password", "synthetic-long-password");
  await submit();
  assert.equal(requests("/session/guest").length, 1);
  assert.equal(requests("/auth/register").length, 1);
  assert.equal(harness.currentSession().user?.kind, "registered");
  assert.equal(harness.currentPath(), "/space");
});

test("an ended session after uncertain confirmation offers login without claiming a rollback", async () => {
  handlers.set("/auth/merge/confirm", async () => {
    handlers.set("/session", () =>
      Response.json({ user: null, csrf_token: null }),
    );
    throw new Error("synthetic lost cookie and confirmation response");
  });
  await showPreview();
  await fill("merge-confirm", "MERGE");
  await click("确认合并并登录");
  assert.equal(harness.currentSession().user, null);
  assert.match(text(), /当前会话已结束。请登录已有账户核对记录/);
  assert.doesNotMatch(
    text(),
    /访客记录尚未合并|当前仍是访客空间|本次合并未执行/,
  );
  assert.equal(button("登录我的空间").disabled, false);
  assert.equal(requests("/auth/merge/confirm").length, 1);
});

test("registered account rotates password and CSRF and requires a replacement recovery code", async () => {
  await harness.act(async () => harness.currentSession().acceptSession(target));
  handlers.set("/auth/password", () =>
    Response.json({ ...target, csrf_token: "password-rotated" }),
  );
  await fill("current-password", "synthetic-old-password");
  await fill("new-password", "synthetic-new-password");
  await fill("repeat-password", "synthetic-new-password");
  await submit();
  assert.equal(requests("/auth/password").length, 1);
  assert.deepEqual(requests("/auth/password")[0].body, {
    current_password: "synthetic-old-password",
    new_password: "synthetic-new-password",
  });
  assert.match(text(), /旧恢复码已失效/);
  assert.equal(harness.currentSession().user?.id, target.user!.id);
  assert.equal(
    (dom.window.document.getElementById("current-password") as HTMLInputElement)
      .value,
    "",
  );
});

test("recovery code replacement requires confirmation, displays once, and can be hidden", async () => {
  await harness.act(async () => harness.currentSession().acceptSession(target));
  handlers.set("/auth/recovery-code", () =>
    Response.json({
      recovery_code: "synthetic-recovery-code",
      shown_once: true,
    }),
  );
  await fill("current-password", "synthetic-password");
  await click("生成新的恢复码");
  assert.equal(requests("/auth/recovery-code").length, 0);
  assert.match(text(), /旧恢复码立即失效/);
  await click("确认生成");
  assert.equal(requests("/auth/recovery-code").length, 1);
  assert.ok(
    dom.window.document.querySelector('input[value="synthetic-recovery-code"]'),
  );
  assert.equal(dom.window.sessionStorage.length, 0);
  await click("我已安全保存，隐藏恢复码");
  assert.equal(
    dom.window.document.querySelector('input[value="synthetic-recovery-code"]'),
    null,
  );
});

test("recovery preserves current guest identity and directs normal login after 204", async () => {
  handlers.set("/auth/recover", () => new Response(null, { status: 204 }));
  await harness.act(async () => harness.go("/recover"));
  await fill("recover-username", "existing");
  await fill("recover-code", "synthetic-recovery-code");
  await fill("recover-password", "synthetic-new-password");
  await fill("recover-repeat", "synthetic-new-password");
  await submit();
  assert.equal(requests("/auth/recover").length, 1);
  assert.equal(harness.currentSession().user?.id, guest.user!.id);
  assert.equal(harness.currentPath(), "/recover");
  assert.match(text(), /当前空间未改变/);
  assert.equal(requests("/auth/login").length, 0);
});

test("all-device logout clears local identity after a successful 204", async () => {
  await harness.act(async () => harness.currentSession().acceptSession(target));
  handlers.set("/auth/logout-all", () => new Response(null, { status: 204 }));
  await click("确认退出所有设备");
  assert.equal(requests("/auth/logout-all").length, 1);
  assert.equal(harness.currentSession().user, null);
});

test("registered deletion submits current password only after explicit DELETE", async () => {
  await harness.act(async () => harness.currentSession().acceptSession(target));
  handlers.set("/me", () => new Response(null, { status: 204 }));
  await click("我要删除账户");
  await fill("delete-confirm", "DELETE");
  assert.equal(button("永久删除").disabled, true);
  await fill("delete-password", "synthetic-password");
  await click("永久删除");
  assert.deepEqual(requests("/me")[0].body, {
    confirmation: "DELETE",
    password: "synthetic-password",
  });
  assert.equal(harness.currentSession().user, null);
});

const journalEntry = (id: string) => ({
  answer_id: id,
  pulse_id: id,
  date: "2026-10-20",
  question: {
    id,
    version: "v1",
    prompt: `问题 ${id}`,
    choice_a: "选择甲",
    choice_b: "选择乙",
  },
  choice: "A",
  answered_at: "2026-10-20T00:00:00Z",
  share_eligible: true,
});
test("journal filters query the server, preserve filters in pagination, and reset cleanly", async () => {
  handlers.set("/journal?", () =>
    Response.json({
      entries: [journalEntry("first")],
      next_cursor: null,
      total: 1,
    }),
  );
  handlers.set("/solo", () =>
    Response.json({
      answered_days: 1,
      required_days: 7,
      eligible: false,
      notice: "慢慢记录",
      self_comparison: null,
    }),
  );
  handlers.set("/journal?from=2026-10-01", () =>
    Response.json({
      entries: [journalEntry("filtered")],
      next_cursor: "next",
      total: 2,
    }),
  );
  handlers.set("/journal?from=2026-10-01&cursor=next", () =>
    Response.json({
      entries: [journalEntry("older")],
      next_cursor: null,
      total: 2,
    }),
  );
  await harness.act(async () => harness.go("/journal"));
  const from = dom.window.document.querySelector(
    '[aria-label="开始日期"]',
  ) as HTMLInputElement;
  from.id = "test-from";
  await fill("test-from", "2026-10-01");
  await submit();
  assert.match(text(), /问题 filtered/);
  assert.doesNotMatch(text(), /问题 first/);
  await click("再往前翻翻");
  assert.match(text(), /问题 older/);
  assert.match(text(), /问题 filtered/);
  assert.equal(requests("/journal?from=2026-10-01&cursor=next").length, 1);
  await click("重置");
  assert.match(text(), /问题 first/);
});

test("self history compares actual saved dimensions and loads earlier assessments", async () => {
  const assessment = (id: string, label: string, score: number) => ({
    id,
    version: "v1",
    created_at: "2026-10-20T00:00:00Z",
    answers: [],
    dimensions: [{ dimension: "D1", label, score, state: "stable" }],
    observations: ["真实观察"],
    summary: `镜像 ${id}`,
    target_dimensions: [],
  });
  handlers.set("/self/history", () =>
    Response.json({
      assessments: [
        assessment("recent", "现在偏好", 1),
        assessment("before", "之前偏好", -1),
      ],
      next_cursor: "older",
      total: 3,
    }),
  );
  handlers.set("/self/history?cursor=older", () =>
    Response.json({
      assessments: [assessment("oldest", "最早偏好", 1)],
      next_cursor: null,
      total: 3,
    }),
  );
  await harness.act(async () => harness.go("/self/history"));
  assert.match(text(), /之前：之前偏好/);
  assert.match(text(), /现在：现在偏好/);
  assert.match(text(), /这一次，有些不同/);
  await click("加载更早镜像");
  assert.match(text(), /最早偏好/);
  assert.equal(requests("/self/history?cursor=older").length, 1);
});

test("invitation management paginates friend links and confirms revocation", async () => {
  handlers.set("/space", () =>
    Response.json({
      user: guest.user,
      self: { completed: true, assessment_id: "a" },
      daily: { saved_count: 1, answered_today: true },
      friends: { completed_count: 0, state: "empty" },
      guesses: { created_count: 0, received_count: 0 },
      guest_expires_at: null,
    }),
  );
  const invite = {
    id: "invite1",
    token: "token1",
    url: "/friend/token1",
    expires_at: "2026-11-01T00:00:00Z",
    status: "active",
    completed_count: 0,
  };
  let revoked = false;
  handlers.set("/invites", () =>
    Response.json({
      invites: [{ ...invite, status: revoked ? "revoked" : "active" }],
      next_cursor: revoked ? null : "token1",
      total: 2,
    }),
  );
  handlers.set("/invites?cursor=token1", () =>
    Response.json({
      invites: [
        { ...invite, id: "invite2", token: "token2", status: "expired" },
      ],
      next_cursor: null,
      total: 2,
    }),
  );
  handlers.set("/guesses", () =>
    Response.json({ rounds: [], next_cursor: null, total: 0 }),
  );
  handlers.set("/invites/invite1", () => {
    revoked = true;
    return new Response(null, { status: 204 });
  });
  await harness.act(async () => harness.go("/manage"));
  await click("加载更早邀请");
  assert.match(text(), /已过期/);
  await click("撤回");
  assert.equal(requests("/invites/invite1").length, 0);
  await click("确认撤回");
  assert.equal(requests("/invites/invite1").length, 1);
  assert.match(text(), /已撤回/);
});

test("a late session refresh cannot overwrite a newer accepted account", async () => {
  let release!: (response: Response) => void;
  handlers.set(
    "/session",
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  let pending!: Promise<Session>;
  await harness.act(async () => {
    pending = harness.currentSession().refresh();
  });
  await harness.act(async () => harness.currentSession().acceptSession(target));
  await harness.act(async () => {
    release(Response.json(guest));
    await pending;
  });
  assert.equal(harness.currentSession().user?.id, target.user!.id);
});

test("window focus revalidates a revoked session and removes registered account controls", async () => {
  await harness.act(async () => harness.currentSession().acceptSession(target));
  handlers.set("/session", () =>
    Response.json({ user: null, csrf_token: null }),
  );
  await harness.act(async () =>
    dom.window.dispatchEvent(new dom.window.Event("focus")),
  );
  assert.equal(harness.currentSession().user, null);
  assert.doesNotMatch(text(), /删除账户与数据/);
});

test("disabled sessionStorage cannot prevent clearing identity and CSRF", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "sessionStorage",
  )!;
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    get() {
      throw new Error("SecurityError: storage blocked");
    },
  });
  try {
    await harness.act(async () =>
      harness.currentSession().acceptSession({ user: null, csrf_token: null }),
    );
    assert.equal(harness.currentSession().user, null);
    handlers.set("/auth/logout", (call) => {
      assert.equal(call.headers.get("X-CSRF-Token"), null);
      return new Response(null, { status: 204 });
    });
    await harness.post("/auth/logout");
  } finally {
    Object.defineProperty(globalThis, "sessionStorage", descriptor);
  }
});

test("history does not compare dimension scores across question versions", async () => {
  const base = {
    created_at: "2026-10-20T00:00:00Z",
    answers: [],
    dimensions: [{ dimension: "D1", label: "偏好", score: 1, state: "stable" }],
    observations: [],
    summary: "镜像",
    target_dimensions: [],
  };
  handlers.set("/self/history", () =>
    Response.json({
      assessments: [
        { ...base, id: "new", version: "v2" },
        { ...base, id: "old", version: "v1" },
      ],
      next_cursor: null,
      total: 2,
    }),
  );
  await harness.act(async () => harness.go("/self/history"));
  assert.match(text(), /不同版本的问题/);
  assert.doesNotMatch(text(), /这一次，偏好相近|这一次，有些不同/);
});

test("recovering a currently signed-in account refreshes the revoked identity", async () => {
  await harness.act(async () => harness.currentSession().acceptSession(target));
  handlers.set("/auth/recover", () => new Response(null, { status: 204 }));
  handlers.set("/session", () =>
    Response.json({ user: null, csrf_token: null }),
  );
  await harness.act(async () => harness.go("/recover"));
  await fill("recover-username", "existing");
  await fill("recover-code", "synthetic-code");
  await fill("recover-password", "synthetic-new-password");
  await fill("recover-repeat", "synthetic-new-password");
  await submit();
  assert.equal(harness.currentSession().user, null);
  assert.match(text(), /密码已重置/);
  assert.doesNotMatch(text(), /当前空间未改变/);
});

test("switching registered identities clears destructive forms and prior display name", async () => {
  await harness.act(async () => harness.currentSession().acceptSession(target));
  await fill("display-name", "Account A unsaved name");
  await click("我要删除账户");
  await fill("delete-password", "synthetic-A-password");
  await fill("delete-confirm", "DELETE");
  await harness.act(async () =>
    harness.currentSession().acceptSession({
      ...target,
      user: { ...target.user!, id: "account-b", display_name: "账户 B" },
    }),
  );
  assert.equal(
    (dom.window.document.getElementById("display-name") as HTMLInputElement)
      .value,
    "账户 B",
  );
  assert.equal(dom.window.document.getElementById("delete-password"), null);
  await click("我要删除账户");
  assert.equal(
    (dom.window.document.getElementById("delete-password") as HTMLInputElement)
      .value,
    "",
  );
  assert.equal(
    (dom.window.document.getElementById("delete-confirm") as HTMLInputElement)
      .value,
    "",
  );
});

test("late invitation pagination cannot restore a revoked link after reload", async () => {
  handlers.set("/space", () =>
    Response.json({
      user: guest.user,
      self: { completed: true, assessment_id: "a" },
      daily: { saved_count: 1, answered_today: true },
      friends: { completed_count: 0, state: "empty" },
      guesses: { created_count: 0, received_count: 0 },
      guest_expires_at: null,
    }),
  );
  const invite = {
    id: "invite1",
    token: "token1",
    url: "/friend/token1",
    expires_at: "2026-11-01T00:00:00Z",
    status: "active",
    completed_count: 0,
  };
  let revoked = false;
  let release!: (response: Response) => void;
  handlers.set("/invites", () =>
    Response.json({
      invites: [{ ...invite, status: revoked ? "revoked" : "active" }],
      next_cursor: revoked ? null : "token1",
      total: 1,
    }),
  );
  handlers.set("/guesses", () =>
    Response.json({ rounds: [], next_cursor: null, total: 0 }),
  );
  handlers.set(
    "/invites?cursor=token1",
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  handlers.set("/invites/invite1", () => {
    revoked = true;
    return new Response(null, { status: 204 });
  });
  await harness.act(async () => harness.go("/manage"));
  await click("加载更早邀请");
  await click("撤回");
  await click("确认撤回");
  assert.match(text(), /已撤回/);
  await harness.act(async () =>
    release(Response.json({ invites: [], next_cursor: null, total: 1 })),
  );
  assert.match(text(), /已撤回/);
  assert.doesNotMatch(text(), /有效至/);
});

test("guess picker resolves an older selected journal answer and paginates additional choices", async () => {
  handlers.set("/self/latest", () => Response.json(null));
  handlers.set("/self/questions", () => Response.json({ questions: [] }));
  handlers.set("/journal?limit=20", () =>
    Response.json({
      entries: [journalEntry("recent")],
      next_cursor: "older",
      total: 102,
    }),
  );
  handlers.set("/journal/entries/oldest", () =>
    Response.json(journalEntry("oldest")),
  );
  handlers.set("/journal?limit=20&cursor=older", () =>
    Response.json({
      entries: [journalEntry("nextpage")],
      next_cursor: null,
      total: 102,
    }),
  );
  handlers.set("/guesses", () =>
    Response.json({
      id: "g",
      token: "token",
      url: "/guess/token",
      expires_at: "2026-11-01T00:00:00Z",
    }),
  );
  await harness.act(async () => harness.go("/guess/new?answer=oldest"));
  assert.match(text(), /问题 oldest/);
  assert.equal(button("收好谜底，生成邀请").disabled, false);
  await click("加载更早的每日选择");
  assert.match(text(), /问题 nextpage/);
  await click("收好谜底，生成邀请");
  assert.deepEqual(requests("/guesses")[0].body, {
    source_type: "pulse",
    answer_id: "oldest",
  });
});

test("account login deep-link opens login rather than registration", async () => {
  await harness.act(async () => harness.go("/other"));
  await harness.act(async () => harness.go("/account?mode=login"));
  assert.ok(button("登录我的空间"));
  assert.equal(dom.window.document.getElementById("nickname"), null);
});

test("changing identity discards the previous account's generated invitation", async () => {
  handlers.set("/self/latest", () =>
    Response.json({
      id: "assessment",
      version: "v1",
      created_at: "2026-10-20",
      answers: [],
      dimensions: [],
      observations: [],
      summary: "",
      target_dimensions: [],
    }),
  );
  handlers.set("/invites", () =>
    Response.json({
      id: "invite",
      token: "account-a-token",
      url: "/friend/account-a-token",
      expires_at: "2026-11-01T00:00:00Z",
    }),
  );
  await harness.act(async () => harness.go("/invite"));
  await click("生成朋友邀请链接");
  assert.ok(
    dom.window.document.querySelector('input[value*="account-a-token"]'),
  );
  await harness.act(async () => harness.currentSession().acceptSession(target));
  assert.equal(
    dom.window.document.querySelector('input[value*="account-a-token"]'),
    null,
  );
  assert.ok(button("生成朋友邀请链接"));
});
