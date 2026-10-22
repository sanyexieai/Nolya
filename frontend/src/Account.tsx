import "./design-daily-space.css";
import { BrandCompanion } from "./ui";
import { invitationShareKind } from "./share-core";
import { SocialShare } from "./Share";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowRight,
  BookOpen,
  Check,
  Download,
  Heart,
  LogOut,
  Settings,
  ShieldCheck,
  Sparkles,
  Trash2,
} from "lucide-react";
import {
  api,
  ApiError,
  errorMessage,
  formatDate,
  newKey,
  patch,
  post,
  shareUrl,
} from "./api";
import type { MergePreview, Session, ShareLink, Space, User } from "./api";
import { useSession } from "./session";
import { SecuritySettings } from "./Security";
import {
  ActionLink,
  Button,
  Empty,
  Loading,
  Notice,
  PageHeading,
  PrivacyNote,
  useResource,
} from "./ui";
export function AccountPage() {
  const { user, loading, ensureGuest, acceptSession, refresh } = useSession();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [mode, setMode] = useState<"register" | "login">(
    params.get("mode") === "login" ? "login" : "register",
  );
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState(user?.display_name || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deletePassword, setDeletePassword] = useState("");
  const [guestExitConfirm, setGuestExitConfirm] = useState(false);
  const [mergeRequired, setMergeRequired] = useState(false);
  const [mergePreview, setMergePreview] = useState<MergePreview | null>(null);
  const [mergeConfirm, setMergeConfirm] = useState("");
  const [mergeUncertain, setMergeUncertain] = useState(false);
  const recoveryNotice = useRef("");
  const mounted = useRef(true);
  const requestVersion = useRef(0);
  const busyRef = useRef(false);
  const bootstrapping = useRef(false);
  const identity = useRef({ id: user?.id, kind: user?.kind });

  // Ignore late UI effects after page/user changes. This does not cancel a
  // server transaction or prevent the browser from applying a Set-Cookie header.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      requestVersion.current += 1;
    };
  }, []);
  useLayoutEffect(() => {
    const previous = identity.current;
    identity.current = { id: user?.id, kind: user?.kind };
    if (previous.id === user?.id && previous.kind === user?.kind) return;
    // Register intentionally creates a first guest session before saving it.
    if (!previous.id && user?.kind === "guest" && bootstrapping.current) return;
    requestVersion.current += 1;
    bootstrapping.current = false;
    busyRef.current = false;
    setBusy(false);
    setPassword("");
    setDisplayName(user?.display_name || "");
    setDeletePassword("");
    setDeleteConfirm("");
    setDeleteOpen(false);
    setGuestExitConfirm(false);
    setMergePreview(null);
    setMergeConfirm("");
    setMergeRequired(false);
    setMergeUncertain(false);
    setError(recoveryNotice.current);
    recoveryNotice.current = "";
    setSuccess("");
  }, [user?.id, user?.kind]);
  useEffect(() => {
    if (!busy && !mergeUncertain) return;
    const preventLinkNavigation = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest("a[href]")) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    document.addEventListener("click", preventLinkNavigation, true);
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => {
      document.removeEventListener("click", preventLinkNavigation, true);
      window.removeEventListener("beforeunload", warnBeforeLeaving);
    };
  }, [busy, mergeUncertain]);

  function beginRequest() {
    if (busyRef.current) return null;
    busyRef.current = true;
    setBusy(true);
    setError("");
    setSuccess("");
    return ++requestVersion.current;
  }
  function isCurrent(version: number) {
    return mounted.current && version === requestVersion.current;
  }
  function finishRequest(version: number) {
    if (!isCurrent(version)) return;
    busyRef.current = false;
    setBusy(false);
  }
  function resetMerge(nextMode: "register" | "login" = mode) {
    if (busyRef.current || mergeUncertain) return;
    requestVersion.current += 1;
    setMode(nextMode);
    setPassword("");
    setMergePreview(null);
    setMergeConfirm("");
    setMergeRequired(false);
    setError("");
    setSuccess("");
  }
  async function auth(e: React.FormEvent) {
    e.preventDefault();
    if (mergeUncertain) return;
    const version = beginRequest();
    if (version === null) return;
    const previewing = mode === "login" && mergeRequired;
    try {
      if (mode === "register") {
        bootstrapping.current = !user;
        await ensureGuest();
        if (!isCurrent(version)) return;
      }
      if (previewing) {
        const result = await post<MergePreview>("/auth/merge/preview", {
          username,
          password,
        });
        if (!isCurrent(version)) return;
        setMergePreview(result);
        setMergeConfirm("");
      } else {
        const result = await post<Session>(`/auth/${mode}`, {
          username,
          password,
          ...(mode === "register"
            ? { display_name: displayName || username }
            : {}),
        });
        if (!isCurrent(version)) return;
        acceptSession(result);
        setPassword("");
        navigate("/space");
      }
    } catch (e) {
      if (!isCurrent(version)) return;
      if (
        mode === "login" &&
        e instanceof ApiError &&
        e.code === "guest_merge_required"
      ) {
        setMergeRequired(true);
        setError("");
      } else {
        setError(errorMessage(e));
      }
    } finally {
      if (isCurrent(version)) {
        bootstrapping.current = false;
        if (previewing) setPassword("");
      }
      finishRequest(version);
    }
  }
  async function confirmMerge() {
    if (
      !mergePreview?.can_merge ||
      !mergePreview.merge_token ||
      mergePreview.conflicts.length ||
      mergeConfirm !== "MERGE"
    )
      return;
    const version = beginRequest();
    if (version === null) return;
    try {
      const result = await post<Session>("/auth/merge/confirm", {
        merge_token: mergePreview.merge_token,
        confirmation: "MERGE",
      });
      if (!isCurrent(version)) return;
      acceptSession(result);
      setMergePreview(null);
      setMergeConfirm("");
      setPassword("");
      sessionStorage.removeItem("nolya-self-draft");
      navigate("/space");
    } catch (e) {
      if (!isCurrent(version)) return;
      // Discard every failed/uncertain confirmation token, never blindly retry it.
      setMergePreview(null);
      setMergeConfirm("");
      setPassword("");
      if (
        e instanceof ApiError &&
        ["merge_preview_stale", "merge_preview_expired"].includes(e.code)
      ) {
        setMergeRequired(true);
        setError(
          e.code === "merge_preview_stale"
            ? "记录发生了变化，本次合并未执行。请重新输入密码，验证并预览最新记录。"
            : "合并预览已失效，本次合并未执行。请重新输入密码，验证并预览。",
        );
      } else {
        setMergeRequired(false);
        setMergeUncertain(true);
        setError("暂时无法确认合并结果，正在读取当前账户状态。请勿重复提交。");
        await reconcileMergeSession(version);
      }
    } finally {
      finishRequest(version);
    }
  }
  async function reconcileMergeSession(version: number) {
    try {
      const result = await api<Session>("/session");
      if (!isCurrent(version)) return;
      if (!result.user) {
        recoveryNotice.current =
          "当前会话已结束。请登录已有账户核对记录，暂不要重新创建访客记录。";
      }
      acceptSession(result);
      setMergeUncertain(false);
      if (result.user?.kind === "registered") {
        sessionStorage.removeItem("nolya-self-draft");
        navigate("/space");
      } else {
        setMode("login");
        setMergeRequired(result.user?.kind === "guest");
        setError(
          result.user?.kind === "guest"
            ? "已确认当前仍是访客空间。请重新输入密码，验证并预览后再决定是否合并。"
            : "当前会话已结束。请登录已有账户核对记录，暂不要重新创建访客记录。",
        );
      }
    } catch {
      if (!isCurrent(version)) return;
      setError(
        "无法确认合并结果，也暂时无法读取账户状态。合并可能已经完成，请先刷新账户状态，不要重复提交或切换账户。",
      );
    }
  }
  async function retryMergeSession() {
    const version = beginRequest();
    if (version === null) return;
    await reconcileMergeSession(version);
    finishRequest(version);
  }
  async function saveName() {
    const version = beginRequest();
    if (version === null) return;
    try {
      await patch<{ user: User }>("/me", { display_name: displayName });
      if (!isCurrent(version)) return;
      await refresh();
      if (!isCurrent(version)) return;
      setSuccess("昵称已保存");
    } catch (e) {
      if (isCurrent(version)) setError(errorMessage(e));
    } finally {
      finishRequest(version);
    }
  }
  async function logout() {
    const version = beginRequest();
    if (version === null) return;
    try {
      await post("/auth/logout");
      if (!isCurrent(version)) return;
      acceptSession({ user: null, csrf_token: null });
      sessionStorage.removeItem("nolya-self-draft");
      navigate("/");
    } catch (e) {
      if (isCurrent(version)) setError(errorMessage(e));
    } finally {
      finishRequest(version);
    }
  }
  async function leaveGuest() {
    const version = beginRequest();
    if (version === null) return;
    try {
      await post("/auth/logout");
      if (!isCurrent(version)) return;
      acceptSession({ user: null, csrf_token: null });
      setMode("login");
      setPassword("");
      setGuestExitConfirm(false);
      setSuccess("已退出访客空间，可以登录已有账户。");
    } catch (e) {
      if (isCurrent(version)) setError(errorMessage(e));
    } finally {
      finishRequest(version);
    }
  }
  async function exportData() {
    const version = beginRequest();
    if (version === null) return;
    try {
      const data = await api<unknown>("/me/export");
      if (!isCurrent(version)) return;
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `nolya-my-data-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setSuccess("数据已准备下载");
    } catch (e) {
      if (isCurrent(version)) setError(errorMessage(e));
    } finally {
      finishRequest(version);
    }
  }
  async function deleteAccount() {
    if (deleteConfirm !== "DELETE") return;
    const version = beginRequest();
    if (version === null) return;
    try {
      await api("/me", {
        method: "DELETE",
        body: JSON.stringify({
          confirmation: "DELETE",
          ...(user?.kind === "registered" ? { password: deletePassword } : {}),
        }),
        headers: { "Idempotency-Key": newKey() },
      });
      if (!isCurrent(version)) return;
      acceptSession({ user: null, csrf_token: null });
      navigate("/");
    } catch (e) {
      if (isCurrent(version)) setError(errorMessage(e));
    } finally {
      finishRequest(version);
    }
  }
  return (
    <div
      className={`container narrow-page ${!loading && user?.kind !== "registered" ? "account-auth-scene" : ""}`}
    >
      {!loading && user?.kind !== "registered" && (
        <aside className="account-auth-visual" aria-label="日常生活品牌场景">
          <img
            className="account-auth-photo"
            src="/design/ambassador-outdoor.jpg"
            alt="树荫下的日常品牌场景，非用户头像"
            width="1122"
            height="1402"
          />
          <div className="account-auth-caption">
            <span>保留你的答题记录</span>
            <h2>注册或登录账户</h2>
            <p>注册新账户可保留当前访客记录；已有账户可登录后查看历史记录。</p>
          </div>
        </aside>
      )}
      <div className="account-auth-content">
        <BrandCompanion label="管理你的账户与记录" />
        {loading ? (
          <Loading />
        ) : user?.kind === "registered" ? (
          <>
            <PageHeading
              eyebrow="账户设置"
              title="账户与数据"
              description="管理昵称、账户安全和已保存的数据。"
            />
            <section className="card account-card">
              <label htmlFor="display-name">昵称</label>
              <input
                id="display-name"
                disabled={busy}
                maxLength={40}
                value={displayName}
                placeholder={user.display_name}
                onChange={(e) => setDisplayName(e.target.value)}
              />
              <p className="small muted">邀请朋友时，他们会看到这个昵称。</p>
              <Button
                busy={busy}
                disabled={!displayName.trim()}
                onClick={saveName}
              >
                保存昵称
              </Button>
              <div className="account-detail">
                <span>用户名</span>
                <strong>{user.username}</strong>
              </div>
              <div className="account-detail">
                <span>账户方式</span>
                <strong>用户名与密码账户</strong>
              </div>
              <Notice kind="info">
                请在下方生成并安全保存恢复码，以便忘记密码时找回账户。
              </Notice>
              <div className="settings-actions">
                <Button secondary busy={busy} onClick={exportData}>
                  <Download size={17} />
                  导出我的数据
                </Button>
                <Button secondary busy={busy} onClick={logout}>
                  <LogOut size={17} />
                  退出登录
                </Button>
              </div>
              {success && <Notice kind="success">{success}</Notice>}
              {error && <Notice>{error}</Notice>}
            </section>
            <SecuritySettings
              key={user.id}
              blocked={busy}
              onBusyChange={(value) => {
                busyRef.current = value;
                setBusy(value);
              }}
            />
            <section className="card danger-zone">
              <h3>删除账户与数据</h3>
              <p>
                永久删除你的自我镜像、每日选择、邀请与互动记录，并撤回有效链接。此操作不可恢复。
              </p>
              {deleteOpen ? (
                <>
                  <label htmlFor="delete-password">当前密码</label>
                  <input
                    id="delete-password"
                    type="password"
                    autoComplete="current-password"
                    disabled={busy}
                    value={deletePassword}
                    onChange={(e) => setDeletePassword(e.target.value)}
                  />
                  <label htmlFor="delete-confirm">
                    输入 DELETE 确认永久删除
                  </label>
                  <input
                    id="delete-confirm"
                    disabled={busy}
                    value={deleteConfirm}
                    onChange={(e) => setDeleteConfirm(e.target.value)}
                    autoComplete="off"
                  />
                  <div className="settings-actions">
                    <Button
                      disabled={deleteConfirm !== "DELETE" || !deletePassword}
                      busy={busy}
                      onClick={deleteAccount}
                      className="danger-button"
                    >
                      永久删除
                    </Button>
                    <Button
                      secondary
                      disabled={busy}
                      onClick={() => {
                        setDeleteOpen(false);
                        setDeleteConfirm("");
                      }}
                    >
                      取消
                    </Button>
                  </div>
                </>
              ) : (
                <button
                  className="text-button danger-text"
                  disabled={busy}
                  onClick={() => setDeleteOpen(true)}
                >
                  <Trash2 size={16} />
                  我要删除账户
                </button>
              )}
            </section>
          </>
        ) : (
          <>
            <PageHeading
              eyebrow="账户"
              title={mode === "register" ? "注册账户" : "登录账户"}
              description="注册新账户可保留当前访客记录。也可以先不注册，继续答题。"
            />
            <section className="card account-card">
              <div className="auth-tabs">
                <button
                  className={mode === "register" ? "active" : ""}
                  disabled={busy || mergeUncertain}
                  onClick={() => resetMerge("register")}
                >
                  保存为账户
                </button>
                <button
                  className={mode === "login" ? "active" : ""}
                  disabled={busy || mergeUncertain}
                  onClick={() => resetMerge("login")}
                >
                  已有账户
                </button>
              </div>
              {mergeUncertain ? (
                <section aria-label="核对合并结果">
                  <Notice>
                    {error ||
                      "合并结果尚未确定，请先读取当前账户状态，不要重复提交。"}
                  </Notice>
                  <Button busy={busy} onClick={retryMergeSession}>
                    刷新账户状态
                  </Button>
                </section>
              ) : mergePreview ? (
                <section
                  className="merge-preview"
                  aria-labelledby="merge-preview-title"
                >
                  <h2 id="merge-preview-title">
                    {mergePreview.can_merge
                      ? "确认合并访客记录"
                      : "暂时无法合并"}
                  </h2>
                  <p>
                    目标账户：
                    <strong>{mergePreview.target.display_name}</strong>
                    <span className="merge-username">
                      @{mergePreview.target.username}
                    </span>
                  </p>
                  <Notice kind="info">
                    当前仍是访客空间。预览只验证账户，不会登录、转移或删除记录。
                  </Notice>
                  <h3>将转移的全部访客记录</h3>
                  <dl className="merge-summary">
                    {(
                      [
                        ["self_assessments", "自我镜像"],
                        ["pulse_answers", "每日选择"],
                        ["friend_responses", "朋友回应"],
                        ["friend_reservations", "未提交的朋友参与预约"],
                        ["friend_invites", "朋友邀请"],
                        ["guesses", "猜测记录"],
                        ["guess_links", "猜测链接"],
                      ] as const
                    ).map(([key, label]) => (
                      <div key={key}>
                        <dt>{label}</dt>
                        <dd>{mergePreview.summary[key]}</dd>
                      </div>
                    ))}
                  </dl>
                  {mergePreview.notice && (
                    <Notice kind="info">{mergePreview.notice}</Notice>
                  )}
                  <ul className="merge-effects">
                    <li>
                      全部访客记录会归入目标账户，目标账户原有昵称和设置保持不变。
                    </li>
                    <li>
                      所有自我镜像都会保留，最新结果按原始创建时间确定；较新的访客镜像可能成为最新结果。
                    </li>
                    <li>
                      已分享的访客链接会改为显示目标账户昵称“
                      {mergePreview.target.display_name}”。
                    </li>
                    <li>
                      成功后会退出所有旧访客会话，并在当前浏览器登录目标账户。
                    </li>
                    <li>
                      合并一次性完成；任何冲突都会阻止整次合并，两个空间均保留，不会跳过或丢弃记录。
                    </li>
                    <li>
                      同一天的每日选择、重复参与同一组朋友反馈或猜测，以及合并后会变成自评或自猜的互动，都会阻止合并。
                    </li>
                  </ul>
                  {mergePreview.conflicts.length > 0 && (
                    <div className="merge-conflicts" role="alert">
                      <h3>需要保留两个独立空间</h3>
                      <ul>
                        {mergePreview.conflicts.map((conflict) => (
                          <li key={conflict.code}>
                            {conflict.message}（{conflict.count} 项）
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {mergePreview.can_merge &&
                  mergePreview.merge_token &&
                  !mergePreview.conflicts.length ? (
                    <>
                      <p className="small muted">
                        预览有效期为 5 分钟。
                        {mergePreview.expires_at && (
                          <>
                            有效至{" "}
                            <time dateTime={mergePreview.expires_at}>
                              {new Date(
                                mergePreview.expires_at,
                              ).toLocaleTimeString("zh-CN")}
                            </time>
                            ；
                          </>
                        )}
                        记录有变化时需要重新验证并预览。
                      </p>
                      <label htmlFor="merge-confirm">
                        输入 MERGE 确认转移全部记录
                      </label>
                      <input
                        id="merge-confirm"
                        value={mergeConfirm}
                        onChange={(e) => setMergeConfirm(e.target.value)}
                        disabled={busy}
                        autoComplete="off"
                        spellCheck={false}
                      />
                      <Button
                        busy={busy}
                        disabled={mergeConfirm !== "MERGE"}
                        onClick={confirmMerge}
                      >
                        确认合并并登录
                      </Button>
                    </>
                  ) : (
                    <Notice>
                      当前不能安全合并。你可以取消并继续访客空间、导出数据，或保存为一个新账户。
                    </Notice>
                  )}
                  <Button
                    secondary
                    disabled={busy}
                    onClick={() => resetMerge("login")}
                  >
                    取消合并，保留访客空间
                  </Button>
                  {error && <Notice>{error}</Notice>}
                </section>
              ) : (
                <form
                  onSubmit={auth}
                  onFocusCapture={(event) => {
                    const field = event.target;
                    if (
                      !(field instanceof HTMLInputElement) ||
                      window.innerWidth > 700
                    )
                      return;
                    // Native Tab scrolling knows the viewport, not our fixed bottom navigation.
                    // Inspect after its scroll, and move only a still-focused, obscured field.
                    window.requestAnimationFrame(() => {
                      if (document.activeElement !== field) return;
                      const nav =
                        document.querySelector<HTMLElement>(".mobile-nav");
                      if (
                        !nav ||
                        window.getComputedStyle(nav).position !== "fixed"
                      )
                        return;
                      const bounds = field.getBoundingClientRect();
                      const navigation = nav.getBoundingClientRect();
                      if (
                        navigation.height > 0 &&
                        bounds.bottom > navigation.top - 12 &&
                        bounds.top < navigation.bottom
                      ) {
                        field.scrollIntoView({
                          block: "center",
                          behavior: "instant",
                        });
                      }
                    });
                  }}
                >
                  {mergeRequired && (
                    <Notice kind="info">
                      访客记录尚未合并，你仍在当前访客空间。请验证已有账户并预览全部记录与冲突，再单独确认是否合并。
                    </Notice>
                  )}
                  {mode === "register" && (
                    <>
                      <label htmlFor="nickname">
                        怎么称呼你 <small>选填</small>
                      </label>
                      <input
                        id="nickname"
                        disabled={busy}
                        maxLength={40}
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        placeholder="朋友熟悉的名字"
                        autoComplete="nickname"
                      />
                    </>
                  )}
                  <label htmlFor="username">用户名</label>
                  <input
                    id="username"
                    disabled={busy}
                    required
                    minLength={3}
                    maxLength={32}
                    pattern="[a-zA-Z0-9_]{3,32}"
                    autoCapitalize="none"
                    autoCorrect="off"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="3–32 位字母、数字或下划线"
                    autoComplete="username"
                  />
                  <label htmlFor="password">密码</label>
                  <input
                    id="password"
                    disabled={busy}
                    type="password"
                    required
                    minLength={mode === "register" ? 12 : 1}
                    maxLength={128}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={
                      mode === "register" ? "至少 12 个字符" : "输入你的密码"
                    }
                    autoComplete={
                      mode === "register" ? "new-password" : "current-password"
                    }
                  />
                  <Notice kind="info">
                    注册后请在账户安全中生成并保存恢复码。本版本不提供邮箱找回。
                  </Notice>
                  <Button type="submit" busy={busy}>
                    {mode === "register"
                      ? "注册账户并保留记录"
                      : mergeRequired
                        ? "验证账户并预览合并"
                        : "登录账户"}
                    <ArrowRight size={17} />
                  </Button>
                  {error && <Notice>{error}</Notice>}
                  {mergeRequired && (
                    <Button
                      secondary
                      disabled={busy}
                      onClick={() => resetMerge("login")}
                    >
                      取消合并，保留访客空间
                    </Button>
                  )}
                </form>
              )}
              <Link className="text-link" to="/recover">
                忘记密码？使用恢复码
              </Link>
              <div className="auth-benefits">
                <span>
                  <Check size={15} />
                  注册保留当前访客记录
                </span>
                <span>
                  <ShieldCheck size={15} />
                  答案默认不公开
                </span>
              </div>
            </section>
            {user?.kind === "guest" && !mergeUncertain && (
              <section className="card guest-data-controls">
                <h3>当前访客数据</h3>
                <p>
                  注册新账户会保留当前访客答题记录。登录已有账户时，可以先预览并确认合并；如有冲突，两个空间会完整保留。你也可以导出访客数据，再明确退出这个访客空间。
                </p>
                <Button secondary busy={busy} onClick={exportData}>
                  <Download size={16} />
                  导出访客数据
                </Button>
                {success && <Notice kind="success">{success}</Notice>}
                <div className="guest-exit-section">
                  {guestExitConfirm ? (
                    <>
                      <Notice kind="info">
                        退出后，这个访客空间可能无法再找回。导出的 JSON
                        是备份，本版暂不提供自动恢复。确定要退出，再登录已有账户吗？
                      </Notice>
                      <div className="settings-actions">
                        <Button secondary busy={busy} onClick={leaveGuest}>
                          退出访客，登录已有账户
                        </Button>
                        <button
                          className="text-button"
                          disabled={busy}
                          onClick={() => setGuestExitConfirm(false)}
                        >
                          取消
                        </button>
                      </div>
                    </>
                  ) : (
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() => setGuestExitConfirm(true)}
                    >
                      <LogOut size={15} />
                      退出访客，改用已有账户
                    </button>
                  )}
                </div>
                <div className="guest-delete-section">
                  {deleteOpen ? (
                    <>
                      <label htmlFor="guest-delete-confirm">
                        永久删除访客数据，请输入 DELETE
                      </label>
                      <input
                        id="guest-delete-confirm"
                        disabled={busy}
                        value={deleteConfirm}
                        onChange={(e) => setDeleteConfirm(e.target.value)}
                        autoComplete="off"
                      />
                      <p>将删除你的记录、撤回邀请并清除会话，不能恢复。</p>
                      <div className="settings-actions">
                        <Button
                          disabled={deleteConfirm !== "DELETE"}
                          busy={busy}
                          onClick={deleteAccount}
                          className="danger-button"
                        >
                          永久删除访客数据
                        </Button>
                        <button
                          className="text-button"
                          disabled={busy}
                          onClick={() => {
                            setDeleteOpen(false);
                            setDeleteConfirm("");
                          }}
                        >
                          取消
                        </button>
                      </div>
                    </>
                  ) : (
                    <button
                      className="text-button danger-text"
                      disabled={busy}
                      onClick={() => setDeleteOpen(true)}
                    >
                      <Trash2 size={15} />
                      永久删除访客数据
                    </button>
                  )}
                </div>
              </section>
            )}
            {!mergeUncertain && (
              <div className="subtle-link-row">
                <Link
                  to="/today"
                  aria-disabled={busy}
                  tabIndex={busy ? -1 : undefined}
                >
                  先不注册，继续答题 <ArrowRight size={15} />
                </Link>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
interface OwnedLink extends ShareLink {
  created_at?: string;
  question?: { prompt: string };
  status: string;
  completed_count?: number;
  guess_count?: number;
}
export function SpacePage() {
  const { user, loading } = useSession();
  const resource = useResource(
    () => (user ? api<Space>("/space") : Promise.resolve(null)),
    [user?.id],
  );
  const space = resource.data;
  return (
    <div className="container space-page nolya-space-design">
      <section className="space-return-hero">
        <div className="space-return-copy">
          <span className="space-return-badge">我的 Nolya</span>
          <h1>
            我的空间
            <br />
            <em>查看记录与结果</em>
          </h1>
          <p>
            查看自我镜像、每日答题记录和朋友反馈，也可以从这里继续答题或管理邀请。
          </p>
        </div>
        <figure className="space-return-photo">
          <img
            src="/design/space-riverside.png"
            alt="Nolya 品牌情境插图，不是用户头像或真实参与者。"
          />
          <Heart size={30} className="space-photo-heart" aria-hidden="true" />
          <figcaption>你的记录与结果</figcaption>
        </figure>
        <div className="space-return-actions">
          <ActionLink to="/today">
            {space?.daily.answered_today ? "查看今日答案" : "开始今日答题"}
          </ActionLink>
          <ActionLink to="/journal" secondary>
            查看答题记录
          </ActionLink>
        </div>
      </section>
      {loading || resource.loading ? (
        <Loading />
      ) : resource.error ? (
        <Notice onRetry={resource.reload}>{resource.error}</Notice>
      ) : !space ? (
        <Empty
          title="暂无个人记录"
          action={
            <ActionLink to="/self">
              开始自我答题 <ArrowRight size={17} />
            </ActionLink>
          }
        >
          无需先注册。你可以完成 8 道自我答题，或参与今日答题。
        </Empty>
      ) : (
        <>
          <header className="space-section-heading">
            <span className="eyebrow">我的结果</span>
            <h2>自我镜像、每日答题与朋友反馈</h2>
            <p>以下状态来自当前身份已保存的记录。</p>
          </header>
          <div className="space-cards">
            <Link
              className="space-card mirror-tile"
              to={space.self.completed ? "/self/result" : "/self"}
            >
              <div className="space-source-title">
                <span className="tile-icon">
                  <Sparkles size={25} />
                </span>
                <div>
                  <h2>自我镜像</h2>
                  <strong className="space-source-status">
                    {space.self.completed
                      ? "已完成 8 道自我答题"
                      : "尚未完成自我答题"}
                  </strong>
                </div>
              </div>
              <p>
                {space.self.completed
                  ? "查看已完成的自我答题结果。"
                  : "完成 8 道二选一题目后查看结果。"}
              </p>
              <span className="tile-action">
                {space.self.completed ? "查看自我结果" : "开始自我答题"}
                <ArrowRight size={17} />
              </span>
            </Link>
            <Link
              className="space-card today-tile"
              to={space.daily.saved_count ? "/journal" : "/today"}
            >
              <div className="space-source-title">
                <span className="tile-icon">
                  <BookOpen size={25} />
                </span>
                <div>
                  <h2>每日答题记录</h2>
                  <strong className="space-source-status">
                    已保存 {space.daily.saved_count} 次答题
                  </strong>
                </div>
              </div>
              <p>
                {space.daily.saved_count
                  ? "查看按日期保存的题目和答案。"
                  : "完成今日答题后即可查看记录。"}
              </p>
              <span className="tile-action">
                {space.daily.saved_count ? "查看答题记录" : "开始今日答题"}
                <ArrowRight size={17} />
              </span>
            </Link>
            <Link
              className="space-card friends-tile"
              to={
                space.friends.completed_count
                  ? "/mirror"
                  : space.capabilities?.can_invite
                    ? "/invite"
                    : "/self"
              }
            >
              <div className="space-source-title">
                <span className="tile-icon">
                  <Heart size={25} />
                </span>
                <div>
                  <h2>朋友反馈</h2>
                  <strong className="space-source-status">
                    {space.friends.completed_count
                      ? `${space.friends.completed_count} 位参与者已完成反馈`
                      : "暂无朋友反馈"}
                  </strong>
                </div>
              </div>
              <p>
                {space.friends.completed_count >= 3
                  ? "已满足查看完整社交镜像的参与人数要求。"
                  : space.friends.completed_count
                    ? "可查看已有反馈；完整社交镜像需要 3 位参与者。"
                    : "朋友反馈需主动邀请，不影响你独立答题。"}
              </p>
              <span className="tile-action">
                {space.friends.completed_count
                  ? "查看朋友反馈"
                  : space.capabilities?.can_invite
                    ? "邀请朋友答题"
                    : "先完成自我答题"}
                <ArrowRight size={17} />
              </span>
            </Link>
          </div>
          <header className="space-section-heading space-next-heading">
            <span className="eyebrow">快捷入口</span>
            <h2>继续答题或查看记录</h2>
          </header>
          <div className="space-next-grid">
            <Link className="space-next-card" to="/today">
              <span>01 · 每天一题</span>
              <h3>
                {space.daily.answered_today ? "查看今日答案" : "开始今日答题"}
              </h3>
              <p>
                {space.daily.answered_today
                  ? "今日答案已保存，可查看答题结果。"
                  : "每天一道二选一题目，无需邀请朋友。"}
              </p>
              <ArrowRight size={23} />
            </Link>
            <Link className="space-next-card" to="/journal">
              <span>02 · 答题记录</span>
              <h3>查看历史答案</h3>
              <p>按日期或选项筛选已提交的答案。</p>
              <ArrowRight size={23} />
            </Link>
            <Link
              className="space-next-card"
              to={space.capabilities?.can_invite ? "/invite" : "/self"}
            >
              <span>03 · 朋友反馈</span>
              <h3>邀请朋友答题</h3>
              <p>
                {space.capabilities?.can_invite
                  ? "邀请一位朋友回答三道生活题。"
                  : "先完成自我镜像，再邀请朋友。"}
              </p>
              <ArrowRight size={23} />
            </Link>
          </div>
          <section className="space-privacy-panel">
            <div>
              <h2>记录与隐私</h2>
              <p>
                只有你主动发起邀请，朋友才会参与相应的问题。你的私人记录不会自动公开。
              </p>
              {user?.kind === "guest" ? (
                <p className="space-guest-notice">
                  <ShieldCheck size={17} />
                  这是你的访客空间。当前浏览器可继续，清除 Cookie
                  或访客会话到期后可能无法找回。
                  {space.guest_expires_at &&
                    `当前会话到 ${formatDate(space.guest_expires_at)}。`}
                </p>
              ) : (
                <p className="space-guest-notice">
                  <Check size={16} />
                  {user?.display_name}的账户空间 · 已保存到当前账户
                </p>
              )}
            </div>
            <div className="space-privacy-actions">
              {user?.kind === "guest" && space.capabilities?.can_register && (
                <ActionLink to="/account">注册并保留记录</ActionLink>
              )}
              <Link to="/account" className="text-link">
                <Settings size={17} />
                隐私与账户
              </Link>
            </div>
          </section>
          <div className="settings-actions space-support-actions">
            <Link className="button secondary" to="/self/history">
              回顾镜像历史
            </Link>
            <Link className="button secondary" to="/help">
              帮助与隐私
            </Link>
          </div>
          <div className="space-links-grid">
            <LinkManager kind="friend" />
            <LinkManager kind="guess" />
          </div>
          <PrivacyNote>以上计数来自已保存的答题与互动记录。</PrivacyNote>
        </>
      )}
    </div>
  );
}
function LinkManager({ kind }: { kind: "friend" | "guess" }) {
  const { user } = useSession();
  const path = kind === "friend" ? "/invites" : "/guesses";
  type Page = {
    invites?: OwnedLink[];
    rounds?: OwnedLink[];
    next_cursor: string | null;
    total: number;
  };
  const resource = useResource(() => api<Page>(path), [user?.id, kind]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");
  const generation = useRef(0);
  useEffect(() => {
    generation.current += 1;
    return () => {
      generation.current += 1;
    };
  }, [user?.id, kind]);
  function reload() {
    generation.current += 1;
    setBusy(false);
    setError("");
    resource.reload();
  }
  const all = resource.data?.invites || resource.data?.rounds || [];
  const active = (link: OwnedLink) =>
    link.status === "active" &&
    !(kind === "friend" && (link.completed_count || 0) >= 3);
  const shown = all.filter(
    (link) =>
      filter === "all" || (filter === "active" ? active(link) : !active(link)),
  );
  async function more() {
    if (!resource.data?.next_cursor || busy) return;
    const version = generation.current;
    setBusy(true);
    setError("");
    try {
      const next = await api<Page>(
        `${path}?cursor=${encodeURIComponent(resource.data.next_cursor)}`,
      );
      if (version !== generation.current) return;
      const entries = [...all, ...(next.invites || next.rounds || [])];
      resource.setData({
        ...next,
        ...(kind === "friend" ? { invites: entries } : { rounds: entries }),
      });
    } catch (e) {
      if (version === generation.current) setError(errorMessage(e));
    } finally {
      if (version === generation.current) setBusy(false);
    }
  }
  return (
    <section className="card">
      <div className="section-label">
        <h2>{kind === "friend" ? "我的朋友邀请" : "我的竞猜邀请"}</h2>
        <Link
          className="text-link"
          to={kind === "friend" ? "/invite" : "/guess/new"}
        >
          新建邀请
        </Link>
      </div>
      <p className="small muted">
        共 {resource.data?.total ?? all.length} 个邀请 · 已加载 {all.length}{" "}
        个，其中 {all.filter(active).length} 个可参与
      </p>
      <label className="link-filter">
        显示
        <select
          aria-label={kind === "friend" ? "筛选朋友邀请" : "筛选猜测邀请"}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="all">全部邀请</option>
          <option value="active">可参与</option>
          <option value="ended">已结束 / 已收齐</option>
        </select>
      </label>
      {resource.loading ? (
        <Loading />
      ) : resource.error ? (
        <Notice onRetry={reload}>{resource.error}</Notice>
      ) : shown.length ? (
        shown.map((link) => (
          <ManageLink key={link.id} link={link} kind={kind} onChange={reload} />
        ))
      ) : (
        <p className="space-empty">
          {all.length
            ? "已加载记录中暂无此状态的邀请。"
            : "暂无邀请。点击“新建邀请”开始。"}
        </p>
      )}
      {resource.data?.next_cursor && (
        <Button
          secondary
          busy={busy}
          disabled={resource.loading}
          onClick={more}
        >
          加载更早邀请
        </Button>
      )}
      {error && <Notice>{error}</Notice>}
    </section>
  );
}
function ManageLink({
  link,
  kind,
  onChange,
}: {
  link: OwnedLink;
  kind: "friend" | "guess";
  onChange: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function revoke() {
    setBusy(true);
    setError("");
    try {
      await api(`/${kind === "friend" ? "invites" : "guesses"}/${link.id}`, {
        method: "DELETE",
        headers: { "Idempotency-Key": newKey() },
      });
      onChange();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  const full = kind === "friend" && (link.completed_count || 0) >= 3;
  return (
    <div className="managed-link">
      <div>
        <span>
          {kind === "friend"
            ? `${link.completed_count || 0} 份反馈已收到`
            : `${link.guess_count || 0} 次猜测已收到`}
        </span>
        <span className="small muted">
          {full && link.status === "active"
            ? "已收齐"
            : link.status === "active"
              ? `有效至 ${formatDate(link.expires_at)}`
              : link.status === "revoked"
                ? "已撤回"
                : link.status === "expired"
                  ? "已过期"
                  : link.status === "full"
                    ? "已收齐"
                    : "已结束"}
        </span>
      </div>
      {link.status === "active" && (
        <>
          <div className="link-actions">
            <button
              disabled={busy || full}
              aria-expanded={open}
              onClick={() => setOpen(!open)}
            >
              {open ? "收起" : "分享链接"}
            </button>
            <button
              disabled={busy}
              aria-expanded={confirm}
              onClick={() => setConfirm(!confirm)}
            >
              撤回
            </button>
          </div>
          {open && !busy && (
            <SocialShare
              value={shareUrl(link, kind)}
              kind={invitationShareKind(kind, link)}
            />
          )}{" "}
          {confirm && (
            <div className="revoke-confirm">
              <p>撤回后，朋友不能再用这个链接参与。已收到的选择会保留。</p>
              <Button busy={busy} secondary onClick={revoke}>
                确认撤回
              </Button>
              <button
                className="text-button"
                disabled={busy}
                onClick={() => setConfirm(false)}
              >
                取消
              </button>
            </div>
          )}
        </>
      )}
      {error && <Notice>{error}</Notice>}
    </div>
  );
}
