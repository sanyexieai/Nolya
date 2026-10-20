import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { errorMessage, post } from "./api";
import type { Session } from "./api";
import { useSession } from "./session";
import { Button, CopyLink, Notice, PageHeading } from "./ui";

export function SecuritySettings({
  blocked = false,
  onBusyChange,
}: {
  blocked?: boolean;
  onBusyChange?: (busy: boolean) => void;
}) {
  const { user, acceptSession } = useSession();
  const identity = useRef(user?.id);
  identity.current = user?.id;
  const alive = useRef(true);
  const inFlight = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const [password, setPassword] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    const hide = () => {
      if (document.hidden) setCode("");
    };
    document.addEventListener("visibilitychange", hide);
    return () => document.removeEventListener("visibilitychange", hide);
  }, []);
  async function run(kind: "password" | "recovery-code" | "logout-all") {
    if (inFlight.current || blocked) return;
    inFlight.current = true;
    onBusyChange?.(true);
    const owner = user?.id;
    const current = () => alive.current && owner === identity.current;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      if (kind === "password") {
        if (next !== repeat) throw new Error("两次新密码不一致。");
        const result = await post<Session>("/auth/password", {
          current_password: password,
          new_password: next,
        });
        if (!current()) return;
        acceptSession(result);
        setNext("");
        setRepeat("");
        setCode("");
        setSuccess(
          "密码已更新，其他设备已退出登录，旧恢复码已失效。请重新生成恢复码。",
        );
      } else if (kind === "recovery-code") {
        const result = await post<{ recovery_code: string }>(
          "/auth/recovery-code",
          { current_password: password },
        );
        if (!current()) return;
        setCode(result.recovery_code);
        setSuccess("新的恢复码已生成，旧恢复码已失效。");
      } else {
        await post("/auth/logout-all");
        if (!current()) return;
        acceptSession({ user: null, csrf_token: null });
        setSuccess("所有设备的登录会话已结束。");
      }
      setPassword("");
      setConfirm(false);
    } catch (e) {
      if (current()) setError(errorMessage(e));
    } finally {
      inFlight.current = false;
      onBusyChange?.(false);
      if (current()) setBusy(false);
    }
  }
  return (
    <section
      className="card account-card security-settings"
      aria-labelledby="security-title"
    >
      <fieldset disabled={busy || blocked} className="security-fields">
        <h2 id="security-title">账户安全</h2>
        <p>密码至少 12 个字符。更改密码会让其他设备退出登录。</p>
        <label htmlFor="current-password">当前密码</label>
        <input
          id="current-password"
          type="password"
          autoComplete="current-password"
          maxLength={128}
          value={password}
          disabled={busy}
          onChange={(e) => setPassword(e.target.value)}
        />
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run("password");
          }}
        >
          <label htmlFor="new-password">新密码</label>
          <input
            id="new-password"
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
            maxLength={128}
            value={next}
            disabled={busy}
            onChange={(e) => setNext(e.target.value)}
          />
          <label htmlFor="repeat-password">再次输入新密码</label>
          <input
            id="repeat-password"
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
            maxLength={128}
            value={repeat}
            disabled={busy}
            onChange={(e) => setRepeat(e.target.value)}
          />
          <Button
            type="submit"
            busy={busy}
            disabled={!password || next.length < 12 || next !== repeat}
          >
            更新密码
          </Button>
        </form>
        <h3>账户恢复码</h3>
        <p>
          忘记密码时可用恢复码找回账户。只显示一次，请保存在密码管理器中，不要分享给他人。离开页面或切换标签页会隐藏它。
        </p>
        {code ? (
          <div className="recovery-code">
            <CopyLink value={code} label="复制恢复码" />
            <Button secondary onClick={() => setCode("")}>
              我已安全保存，隐藏恢复码
            </Button>
          </div>
        ) : (
          <Button
            secondary
            busy={busy}
            disabled={!password}
            onClick={() => setConfirm(true)}
          >
            生成新的恢复码
          </Button>
        )}
        {confirm && (
          <div className="revoke-confirm">
            <p>生成后旧恢复码立即失效。确定替换并安全保存新恢复码吗？</p>
            <Button
              busy={busy}
              disabled={!password}
              onClick={() => void run("recovery-code")}
            >
              确认生成
            </Button>
            <Button secondary disabled={busy} onClick={() => setConfirm(false)}>
              取消
            </Button>
          </div>
        )}
        <details>
          <summary>退出所有设备</summary>
          <p>
            包括当前浏览器。未保存的页面内容不会保留，请确认记得密码或已保存恢复码。
          </p>
          <Button secondary busy={busy} onClick={() => void run("logout-all")}>
            确认退出所有设备
          </Button>
        </details>
        {error && <Notice>{error}</Notice>}
        {success && <Notice kind="success">{success}</Notice>}
      </fieldset>
    </section>
  );
}

export function RecoverPage() {
  const { user, refresh } = useSession();
  const navigate = useNavigate();
  const [recovered, setRecovered] = useState(false);
  const [username, setUsername] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const alive = useRef(true);
  const identity = useRef(user?.id);
  identity.current = user?.id;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (inFlight.current || password !== repeat) return;
    inFlight.current = true;
    const owner = user?.id;
    const current = () => alive.current && identity.current === owner;
    setBusy(true);
    setError("");
    try {
      await post("/auth/recover", {
        username,
        recovery_code: code,
        new_password: password,
      });
      if (!current()) return;
      setCode("");
      setPassword("");
      setRepeat("");
      setRecovered(true);
      try {
        await refresh();
      } catch {
        if (alive.current)
          setError(
            "密码已重置，但暂时无法更新登录状态。请重新加载页面后登录，不要重复使用恢复码。",
          );
      }
    } catch (e) {
      if (current()) setError(errorMessage(e));
    } finally {
      inFlight.current = false;
      if (alive.current) setBusy(false);
    }
  }
  return (
    <div className="container narrow-page">
      <PageHeading
        eyebrow="安全地回到你的空间"
        title="使用恢复码找回账户"
        description="恢复成功后旧密码、旧恢复码和其他登录会话将失效。请重新生成并保存恢复码。"
      />
      {recovered ? (
        <Notice kind="success">
          密码已重置，恢复码已使用。
          {user?.kind === "guest"
            ? "当前空间未改变，请使用新密码登录并按需合并访客记录。"
            : "请使用新密码登录，并重新生成恢复码。"}
          {error && <p>{error}</p>}
          <Button onClick={() => navigate("/account?mode=login")}>
            前往登录
          </Button>
        </Notice>
      ) : (
        <form className="card account-card" onSubmit={submit}>
          {user && (
            <Notice kind="info">
              恢复不会合并记录。访客空间会保留；被恢复账户的所有会话会失效，成功后请使用新密码登录。
            </Notice>
          )}
          <label htmlFor="recover-username">用户名</label>
          <input
            id="recover-username"
            required
            autoComplete="username"
            autoCapitalize="none"
            maxLength={32}
            value={username}
            disabled={busy}
            onChange={(e) => setUsername(e.target.value)}
          />
          <label htmlFor="recover-code">恢复码</label>
          <input
            id="recover-code"
            required
            autoComplete="off"
            spellCheck={false}
            value={code}
            disabled={busy}
            onChange={(e) => setCode(e.target.value)}
          />
          <label htmlFor="recover-password">新密码</label>
          <input
            id="recover-password"
            type="password"
            required
            autoComplete="new-password"
            minLength={12}
            maxLength={128}
            value={password}
            disabled={busy}
            onChange={(e) => setPassword(e.target.value)}
          />
          <label htmlFor="recover-repeat">再次输入新密码</label>
          <input
            id="recover-repeat"
            type="password"
            required
            autoComplete="new-password"
            minLength={12}
            maxLength={128}
            value={repeat}
            disabled={busy}
            onChange={(e) => setRepeat(e.target.value)}
          />
          {repeat && password !== repeat && <Notice>两次新密码不一致。</Notice>}
          <Button
            type="submit"
            busy={busy}
            disabled={!code || password.length < 12 || password !== repeat}
          >
            重置账户密码
          </Button>
          {error && <Notice>{error}</Notice>}
          <p className="small muted">
            没有恢复码时无法验证账户归属，请勿向他人提供密码或恢复码。
          </p>
        </form>
      )}
      <Link className="text-link" to="/account?mode=login">
        返回登录
      </Link>
    </div>
  );
}
