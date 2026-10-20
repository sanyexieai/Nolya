import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import {
  ArrowUpRight,
  ArrowRight,
  Check,
  ChevronRight,
  CircleUserRound,
  Compass,
  Copy,
  Heart,
  LoaderCircle,
  Moon,
  Sparkles,
  Sun,
  X,
} from "lucide-react";
import { useSession } from "./session";
import { errorMessage } from "./api";
import type { Choice, Question } from "./api";
export const Arrow = () => <ArrowRight size={18} aria-hidden="true" />;
export function Badge({
  children,
  pink = false,
}: {
  children: ReactNode;
  pink?: boolean;
}) {
  return (
    <span className={`badge ${pink ? "pink" : ""}`}>
      <Sparkles size={13} aria-hidden="true" />
      {children}
    </span>
  );
}
export function Button({
  children,
  onClick,
  disabled,
  busy,
  secondary,
  type = "button",
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  busy?: boolean;
  secondary?: boolean;
  type?: "button" | "submit";
  className?: string;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={`button ${secondary ? "secondary" : ""} ${className}`}
    >
      {busy && <LoaderCircle className="spin" size={18} />} {children}
    </button>
  );
}
export function ActionLink({
  to,
  children,
  secondary = false,
  className = "",
}: {
  to: string;
  children: ReactNode;
  secondary?: boolean;
  className?: string;
}) {
  return (
    <Link
      className={`button ${secondary ? "secondary" : ""} ${className}`}
      to={to}
    >
      {children}
    </Link>
  );
}
export function Notice({
  children,
  kind = "error",
  onRetry,
}: {
  children: ReactNode;
  kind?: "error" | "info" | "success";
  onRetry?: () => void;
}) {
  return (
    <div
      className={`notice ${kind}`}
      role={kind === "error" ? "alert" : "status"}
    >
      <span>{children}</span>
      {onRetry && (
        <button onClick={onRetry}>
          再试一次 <ArrowRight size={14} />
        </button>
      )}
    </div>
  );
}
export function Loading({ text = "正在打开这一页…" }: { text?: string }) {
  return (
    <div className="loading-state" role="status">
      <LoaderCircle className="spin" size={28} />
      <p>{text}</p>
    </div>
  );
}
export function Empty({
  icon = "✧",
  title,
  children,
  action,
}: {
  icon?: string;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">{icon}</span>
      <h2>{title}</h2>
      <p>{children}</p>
      {action}
    </div>
  );
}
export function PageHeading({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <Badge>{eyebrow}</Badge>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {children}
    </div>
  );
}
export function Layout({ children }: { children: ReactNode }) {
  const { user } = useSession();
  const location = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);
  return (
    <>
      <a className="skip-link" href="#main-content">
        跳到主要内容
      </a>
      <header className="site-header">
        <div className="header-inner">
          <Link to="/" className="wordmark" aria-label="Nolya 首页">
            Nolya<span>.</span>
          </Link>
          <nav className="desktop-nav" aria-label="主要导航">
            <NavLink to="/mirror">镜像</NavLink>
            <NavLink to="/today">今天</NavLink>
            <NavLink to="/space">我的空间</NavLink>
          </nav>
          <div className="header-right">
            <span className="locale-label">简体中文</span>
            <Link
              to={user?.kind === "registered" ? "/space" : "/account"}
              className="account-link"
            >
              <span className="avatar">
                <Sparkles size={18} />
              </span>
              <span>
                {user?.kind === "registered"
                  ? user.display_name
                  : "保存我的选择"}
              </span>
            </Link>
          </div>
        </div>
      </header>
      <main id="main-content" tabIndex={-1}>
        {children}
      </main>
      <footer className="site-footer">
        <Link className="wordmark small" to="/">
          Nolya<span>.</span>
        </Link>
        <p>先选一选，再慢慢发现更多面的自己。</p>
        <Link to="/help">帮助与隐私</Link>
      </footer>
      <nav className="mobile-nav" aria-label="手机导航">
        <NavLink to="/" end>
          <Compass size={20} />
          发现
        </NavLink>
        <NavLink to="/mirror">
          <Sparkles size={20} />
          镜像
        </NavLink>
        <NavLink to="/today">
          <Sun size={20} />
          今天
        </NavLink>
        <NavLink to="/space">
          <CircleUserRound size={20} />我
        </NavLink>
      </nav>
    </>
  );
}
export function Options({
  question,
  selected,
  onSelect,
  disabled = false,
}: {
  question: Question;
  selected?: Choice;
  onSelect: (choice: Choice) => void;
  disabled?: boolean;
}) {
  return (
    <div
      className="options"
      role="radiogroup"
      aria-label={question.prompt}
      onKeyDown={(event) => {
        if (
          disabled ||
          !["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"].includes(
            event.key,
          )
        )
          return;
        event.preventDefault();
        const next = selected === "A" ? "B" : "A";
        onSelect(next);
        const buttons =
          event.currentTarget.querySelectorAll<HTMLButtonElement>(
            "[role=radio]",
          );
        buttons[next === "A" ? 0 : 1]?.focus();
      }}
    >
      {(["A", "B"] as const).map((choice) => (
        <button
          type="button"
          key={choice}
          role="radio"
          aria-checked={selected === choice}
          tabIndex={
            selected ? (selected === choice ? 0 : -1) : choice === "A" ? 0 : -1
          }
          disabled={disabled}
          onClick={() => onSelect(choice)}
          className={`option ${selected === choice ? "selected" : ""}`}
        >
          <span className="option-letter">{choice}</span>
          <span>{choice === "A" ? question.choice_a : question.choice_b}</span>
          {selected === choice && <Check className="option-check" size={21} />}
        </button>
      ))}
    </div>
  );
}
export function Progress({
  current,
  total,
}: {
  current: number;
  total: number;
}) {
  return (
    <div
      className="progress-track"
      role="progressbar"
      aria-valuemin={1}
      aria-valuemax={total}
      aria-valuenow={current}
      aria-label={`已到第 ${current} 题，共 ${total} 题`}
    >
      {Array.from({ length: total }, (_, i) => (
        <span className={i < current ? "filled" : ""} key={i} />
      ))}
    </div>
  );
}
export function PrivacyNote({
  children = "只记录你的选择，不会自动公开。",
}: {
  children?: ReactNode;
}) {
  return (
    <p className="privacy-note">
      <span>✧</span>
      {children}
    </p>
  );
}
export function CopyLink({
  value,
  label = "复制邀请链接",
}: {
  value: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setError("无法自动复制，请长按或选中上方链接手动复制。");
    }
  }
  return (
    <>
      <div className="copy-field">
        <input
          readOnly
          aria-label="分享链接"
          value={value}
          onFocus={(e) => e.target.select()}
        />
        <button onClick={copy} aria-label={label}>
          {copied ? <Check size={19} /> : <Copy size={19} />}
        </button>
      </div>
      <Button onClick={copy} secondary>
        {copied ? (
          <>
            <Check size={17} />
            已复制
          </>
        ) : (
          <>
            <Copy size={17} />
            {label}
          </>
        )}
      </Button>
      {error && <Notice kind="info">{error}</Notice>}
    </>
  );
}
export function SmallArrowLink({
  to,
  children,
}: {
  to: string;
  children: ReactNode;
}) {
  return (
    <Link to={to} className="text-link">
      {children}
      <ArrowUpRight size={16} />
    </Link>
  );
}
export function Dialog({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  useEffect(() => {
    function key(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onClose]);
  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <section
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          className="icon-button dialog-close"
          aria-label="关闭"
          onClick={onClose}
        >
          <X />
        </button>
        <h2>{title}</h2>
        {children}
      </section>
    </div>
  );
}
export function useResource<T>(
  fetcher: () => Promise<T>,
  dependencies: unknown[] = [],
) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let current = true;
    setLoading(true);
    setError("");
    fetcher()
      .then((value) => {
        if (current) setData(value);
      })
      .catch((e) => {
        if (current) setError(errorMessage(e));
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [...dependencies, version]);
  return {
    data,
    setData,
    error,
    loading,
    reload: () => setVersion((v) => v + 1),
  };
}
export function HeroArt({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={`hero-art ${compact ? "compact" : ""}`}
      aria-label="多种颜色的镜像，象征不同角度的自己"
      role="img"
    >
      <div className="art-orbit orbit-one" />
      <div className="art-orbit orbit-two" />
      <div className="art-circle circle-peach" />
      <div className="art-circle circle-purple" />
      <div className="art-spark spark-one">✧</div>
      <div className="art-spark spark-two">✧</div>
      <div className="art-note">
        不同的视角
        <br />
        遇见更多面的你 <Heart size={17} />
      </div>
      <div className="mirror-frame">
        <div className="mirror-surface">
          <div className="reflection-halo" />
          <div className="reflection reflection-back" />
          <div className="reflection reflection-front">
            <div className="reflection-head" />
            <div className="reflection-body" />
          </div>
          <div className="mirror-line" />
          <span className="mirror-caption">YOU, IN A DIFFERENT LIGHT</span>
        </div>
        <div className="mirror-foot">
          每一面，都是你 <Sparkles size={15} />
        </div>
      </div>
      <div className="floating-note note-one">
        <span className="note-symbol">
          <Sun size={22} />
        </span>
        <div>
          <small>自己眼中的我</small>
          <strong>先听听自己的想法</strong>
        </div>
      </div>
      <div className="floating-note note-two">
        <span className="note-symbol peach">
          <Heart size={22} />
        </span>
        <div>
          <small>朋友眼中的我</small>
          <strong>也许还有另一面</strong>
        </div>
      </div>
      <div className="tiny-note">
        <Moon size={16} /> 从一个选择开始 <ChevronRight size={14} />
      </div>
    </div>
  );
}
