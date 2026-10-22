import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  api,
  ApiError,
  errorMessage,
  formatDate,
  mutate,
  post,
  setCsrfToken,
  shareUrl,
} from "../src/api.ts";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  setCsrfToken(null);
});
function stubResponse(body: unknown, status = 200) {
  globalThis.fetch = async () =>
    new Response(status === 204 ? null : JSON.stringify(body), {
      status,
      headers: status === 204 ? {} : { "Content-Type": "application/json" },
    });
}

test("same-origin API read sends credentials and no mutation headers", async () => {
  globalThis.fetch = async (path, options) => {
    assert.equal(path, "/api/v1/self/questions");
    assert.equal(options?.credentials, "include");
    assert.equal(new Headers(options?.headers).has("X-CSRF-Token"), false);
    assert.equal(new Headers(options?.headers).has("Idempotency-Key"), false);
    return Response.json({ questions: [] });
  };
  assert.deepEqual(await api("/self/questions"), { questions: [] });
});

test("domain mutation sends CSRF and stable supplied idempotency key", async () => {
  setCsrfToken("synthetic-test-csrf");
  const seen: string[] = [];
  globalThis.fetch = async (_path, options) => {
    const headers = new Headers(options?.headers);
    assert.equal(headers.get("X-CSRF-Token"), "synthetic-test-csrf");
    assert.equal(headers.get("Content-Type"), "application/json");
    seen.push(headers.get("Idempotency-Key") || "");
    assert.deepEqual(JSON.parse(options!.body as string), { choice: "A" });
    return Response.json({ saved: true });
  };
  await mutate(
    "/pulse/test/answers",
    { choice: "A" },
    "stable-test-request-key",
  );
  await mutate(
    "/pulse/test/answers",
    { choice: "A" },
    "stable-test-request-key",
  );
  assert.deepEqual(seen, [
    "stable-test-request-key",
    "stable-test-request-key",
  ]);
});

test("domain writes receive an idempotency key even when caller omitted it", async () => {
  globalThis.fetch = async (_path, options) => {
    assert.match(
      new Headers(options?.headers).get("Idempotency-Key") || "",
      /^[0-9a-f-]{36}$/,
    );
    return Response.json({ saved: true });
  };
  await post("/invites", { self_assessment_id: "synthetic" });
});

test("bootstrap and auth writes are exempt from idempotency", async () => {
  globalThis.fetch = async (_path, options) => {
    assert.equal(new Headers(options?.headers).has("Idempotency-Key"), false);
    assert.equal(
      new Headers(options?.headers).get("Content-Type"),
      "application/json",
    );
    return Response.json({ user: null, csrf_token: null });
  };
  await post("/session/guest");
  await post("/auth/logout");
});

test("structured errors preserve safe server message, status and code", async () => {
  stubResponse(
    { error: { code: "already_answered", message: "今天已经留下过选择" } },
    409,
  );
  await assert.rejects(
    () => post("/pulse/test/answers", { choice: "B" }),
    (e: unknown) => {
      assert.ok(e instanceof ApiError);
      assert.equal(e.status, 409);
      assert.equal(e.code, "already_answered");
      assert.equal(e.message, "今天已经留下过选择");
      return true;
    },
  );
});

test("invalid non-JSON upstream errors become an honest fallback message", async () => {
  globalThis.fetch = async () =>
    new Response("upstream unavailable", { status: 503 });
  await assert.rejects(
    () => api("/mirror"),
    (e: unknown) => {
      assert.ok(e instanceof ApiError);
      assert.equal(e.status, 503);
      assert.equal(e.message, "操作未完成，请稍后重试。");
      return true;
    },
  );
});

test("network failure never pretends a write succeeded", async () => {
  globalThis.fetch = async () => {
    throw new Error("synthetic network failure");
  };
  await assert.rejects(
    () => mutate("/self/assessments", {}, "synthetic-key"),
    (e: unknown) => {
      assert.ok(e instanceof ApiError);
      assert.equal(e.status, 0);
      assert.match(e.message, /连接不上/);
      return true;
    },
  );
});

test("204 logout/delete responses do not require a JSON body", async () => {
  stubResponse(null, 204);
  assert.equal(await post("/auth/logout"), null);
});

test("CSRF rotation uses latest token and clears on logout", async () => {
  const seen: (string | null)[] = [];
  globalThis.fetch = async (_path, options) => {
    seen.push(new Headers(options?.headers).get("X-CSRF-Token"));
    return Response.json({});
  };
  setCsrfToken("synthetic-old");
  await post("/auth/login");
  setCsrfToken("synthetic-rotated");
  await post("/auth/logout");
  setCsrfToken(null);
  await post("/session/guest");
  assert.deepEqual(seen, ["synthetic-old", "synthetic-rotated", null]);
});

test("sharing derives same-origin routes and safely encodes opaque tokens", () => {
  const previous = globalThis.window;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { location: { origin: "http://127.0.0.1:3000" } },
  });
  try {
    const link = {
      id: "test",
      token: "a/b?c",
      url: "https://untrusted.invalid/",
      expires_at: "2026-10-20",
    };
    assert.equal(
      shareUrl(link, "friend"),
      "http://127.0.0.1:3000/friend/a%2Fb%3Fc",
    );
    assert.equal(
      shareUrl(link, "guess"),
      "http://127.0.0.1:3000/guess/a%2Fb%3Fc",
    );
  } finally {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: previous,
    });
  }
});

test("dates use China schedule and error helper handles unknown values", () => {
  assert.equal(formatDate("2026-10-19"), "10月19日");
  assert.equal(formatDate("2026-10-18T23:00:00Z"), "10月19日");
  assert.equal(errorMessage(new Error("retriable")), "retriable");
  assert.equal(errorMessage(null), "操作失败，请重试。");
});
