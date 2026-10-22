import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, Download, Image, Share2 } from "lucide-react";
import { useSession } from "./session";
import { Button, Notice } from "./ui";
import {
  checkedShareUrl,
  copyPayload,
  defaultShareText,
  isLocalShareUrl,
  pngFile,
  renderSharePoster,
  sharePlatforms,
  shareTitle,
  shareArtwork,
} from "./share-core";
import type { ShareKind, SharePlatform } from "./share-core";
export function SocialShare({
  value,
  kind = "friend",
}: {
  value: string;
  kind?: ShareKind;
}) {
  const { user } = useSession();
  return (
    <SharePanel
      key={`${user?.id || "signed-out"}:${kind}:${value}`}
      value={value}
      kind={kind}
    />
  );
}
export function ResultShare({
  kind,
  summary,
}: {
  kind: "self" | "mirror";
  summary: string;
}) {
  const { user } = useSession();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [user?.id, summary]);
  return (
    <section className="result-share-entry">
      <h2>分享评估结果</h2>
      <p>
        仅分享你确认的概括，不含逐题答案、朋友姓名或个人回答。应用链接不会公开你的结果。
      </p>
      <Button secondary onClick={() => setOpen(!open)}>
        {open ? "收起分享预览" : "分享结果"}
      </Button>
      {open && (
        <SharePanel
          key={`${user?.id}:${kind}:${summary}`}
          value={`${window.location.origin}/`}
          kind={kind}
          initialCaption={summary.slice(0, 160)}
        />
      )}
    </section>
  );
}
export function SharePanel({
  value,
  kind,
  initialCaption,
}: {
  value: string;
  kind: ShareKind;
  initialCaption?: string;
}) {
  const resultShare = kind === "self" || kind === "mirror";
  const [platform, setPlatform] = useState<SharePlatform>("wechat");
  const [caption, setCaption] = useState(
    initialCaption ?? defaultShareText(kind),
  );
  const [poster, setPoster] = useState<{ key: string; data: string }>();
  const [attempt, setAttempt] = useState(0);
  const [photoFailed, setPhotoFailed] = useState(false);
  const [posterError, setPosterError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState("");
  const mounted = useRef(true);
  const current = useRef("");
  const revision = `${value}:${kind}:${platform}:${caption}:${attempt}`;
  current.current = revision;
  const format = sharePlatforms.find((item) => item.id === platform)!;
  let invalid = "";
  let local = false;
  try {
    checkedShareUrl(value);
    local = isLocalShareUrl(value);
  } catch {
    invalid = "邀请链接无效，请返回重新生成。";
  }
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setPhotoFailed(false);
    setPosterError("");
    setNotice("");
    setCopied("");
    if (!invalid)
      renderSharePoster(kind, value, caption, platform, controller.signal)
        .then((data) => {
          if (active) setPoster({ key: revision, data });
        })
        .catch(() => {
          if (active)
            setPosterError(
              "海报生成失败。仍可复制链接或文案分享，也可以重新生成海报。",
            );
        });
    return () => {
      active = false;
      controller.abort();
    };
  }, [revision, invalid]);
  const ready = poster?.key === revision ? poster.data : undefined;
  const file = useMemo(() => {
    try {
      return ready ? pngFile(ready) : undefined;
    } catch {
      return undefined;
    }
  }, [ready]);
  const supportsShare = typeof navigator.share === "function";
  let supportsFiles = false;
  try {
    supportsFiles = !!(
      file &&
      supportsShare &&
      navigator.canShare?.({ files: [file] })
    );
  } catch {
    /* Unsupported payload. */
  }
  async function copy(text: string, label: string) {
    const started = revision;
    try {
      await navigator.clipboard.writeText(text);
      if (mounted.current && current.current === started) {
        setCopied(label);
        setNotice(`${label}已复制。请到目标应用自行发送。`);
      }
    } catch {
      if (mounted.current && current.current === started)
        setNotice("无法自动复制，请选中下方文本手动复制。");
    }
  }
  async function systemShare(withImage: boolean) {
    if (busy) return;
    const started = revision;
    setBusy(true);
    setNotice("");
    try {
      if (withImage && file)
        await navigator.share({
          files: [file],
          title: shareTitle(kind),
          text: caption,
        });
      else
        await navigator.share({
          title: shareTitle(kind),
          text: caption,
          url: value,
        });
      if (mounted.current && current.current === started)
        setNotice("已交给系统分享。是否发送或发布，请在所选应用中确认。");
    } catch (error) {
      if (mounted.current && current.current === started)
        setNotice(
          error instanceof Error && error.name === "AbortError"
            ? "已取消系统分享，没有自动发送。"
            : "系统分享未完成。你可以复制链接或保存海报后自行分享。",
        );
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  if (invalid) return <Notice>{invalid}</Notice>;
  return (
    <section
      className="social-share"
      aria-label={resultShare ? "分享结果" : "分享邀请"}
    >
      <div className="share-introduction">
        <div className="social-share-heading">
          <span className="share-kicker">
            {resultShare ? "分享评估结果" : "分享邀请"}
          </span>
          <h3>选择你的分享方式</h3>
          <p>先预览，再由你决定发给谁。不会自动发布。</p>
        </div>
        <figure className="share-brand-art">
          {!photoFailed ? (
            <img
              key={attempt}
              className="share-brand-photo"
              src={shareArtwork[kind]}
              alt="原设计品牌示意人物，非用户照片"
              onError={() => setPhotoFailed(true)}
            />
          ) : (
            <div className="share-brand-fallback">图片暂未加载</div>
          )}
          <figcaption>品牌示意图，非用户照片</figcaption>
        </figure>
      </div>
      <div className="share-platforms" role="group" aria-label="选择社交平台">
        {sharePlatforms.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={platform === item.id}
            onClick={() => setPlatform(item.id)}
          >
            {item.name}
          </button>
        ))}
      </div>
      <p className="share-guide" data-testid="share-guide">
        {platform === "wechat"
          ? "复制专属链接 → 打开微信 → 粘贴给朋友"
          : platform === "moments"
            ? "保存海报 → 打开朋友圈 → 选图配文"
            : platform === "douyin"
              ? "保存海报 → 打开抖音 → 图片创作"
              : platform === "xiaohongshu"
                ? "保存海报 → 打开小红书 → 选图配文"
                : "选择系统分享，或保存后自行发送"}
      </p>
      {resultShare && (
        <p className="share-disclosure">
          分享结果请保存海报；应用链接不包含你的个人结果。
        </p>
      )}
      {local && (
        <Notice kind="info">
          当前是本机或局域网链接，其他设备可能无法打开。公网邀请需使用可访问的
          HTTPS 地址。
        </Notice>
      )}
      {kind === "reverse" && (
        <Notice kind="info">
          这是定向反向邀请，仅原邀请人可以参与。请私发，不建议发布到公开平台。
        </Notice>
      )}
      <div className="share-preview-layout">
        <div className="share-poster-wrap">
          {ready ? (
            <img
              className="share-poster"
              src={ready}
              alt={`${format.name}分享海报预览，含文案摘要与二维码，请核对图片内容`}
            />
          ) : (
            <div className="share-poster-placeholder" role="status">
              <Image size={30} />
              <span>
                {posterError ? "暂时无法生成海报" : "正在准备分享海报…"}
              </span>
            </div>
          )}
          <small>
            {format.width} × {format.height} PNG ·{" "}
            {platform === "moments"
              ? "1:1"
              : platform === "douyin"
                ? "9:16"
                : "3:4"}
          </small>
          <div className="share-export-actions">
            {ready ? (
              <a
                className="button share-download"
                href={ready}
                download={`nolya-${platform}-invitation.png`}
                onClick={() =>
                  setNotice(
                    "已发起保存海报。若浏览器没有下载，可长按预览图片保存；之后请到目标应用自行发送。 ",
                  )
                }
              >
                <Download size={18} />
                保存分享海报
              </a>
            ) : (
              <Button disabled>
                <Download size={18} />
                保存分享海报
              </Button>
            )}
            <Button secondary onClick={() => copy(value, "链接")}>
              {copied === "链接" ? <Check size={17} /> : <Copy size={17} />}
              {resultShare ? "复制应用链接" : "复制邀请链接"}
            </Button>
            {supportsShare && (
              <Button secondary busy={busy} onClick={() => systemShare(false)}>
                <Share2 size={17} />
                系统分享链接
              </Button>
            )}
            {supportsFiles && (
              <Button secondary busy={busy} onClick={() => systemShare(true)}>
                <Share2 size={17} />
                系统分享海报
              </Button>
            )}
          </div>
        </div>
        <div className="share-editor">
          <label>
            分享文案
            <textarea
              aria-label="分享文案"
              value={caption}
              maxLength={160}
              rows={3}
              onChange={(e) => setCaption(e.target.value)}
            />
          </label>
          <p className="share-disclosure">
            只分享你确认的文案与二维码，不自动带入个人回答。
          </p>
          <label>
            {resultShare ? "应用链接（不包含个人结果）" : "邀请链接"}
            <input
              aria-label="分享链接"
              readOnly
              value={value}
              onFocus={(e) => e.target.select()}
            />
          </label>
          <div className="share-copy-actions">
            <Button
              secondary
              onClick={() => copy(copyPayload(caption, value), "文案和链接")}
            >
              <Copy size={17} />
              复制文案和链接
            </Button>
          </div>
        </div>
      </div>
      {posterError && (
        <Notice kind="info">
          {posterError}
          <button
            type="button"
            className="text-button"
            onClick={() => setAttempt((value) => value + 1)}
          >
            重新生成海报
          </button>
        </Notice>
      )}
      {!supportsShare && (
        <p className="share-support-note">
          此浏览器没有系统分享面板，可使用上方复制和保存功能。
        </p>
      )}
      {notice && <Notice kind="info">{notice}</Notice>}
      <details className="share-details">
        <summary>平台说明与分享隐私</summary>
        <p>{format.guide}</p>
        {resultShare && (
          <p>应用链接不包含你的个人结果，只能通过海报查看你确认的概括。</p>
        )}
        <p className="share-disclosure">
          海报只包含品牌、分享说明、你确认或编辑的文案和二维码，不自动包含真实答案或朋友的个人回答。长文案可能在海报中省略，请核对预览；复制文案保留全文。
        </p>
        <p>
          生成与保存只在当前浏览器进行。平台入口提供操作指引，并非平台直发；发布前请确认可见范围。海报二维码与下方链接一致。
        </p>
      </details>
    </section>
  );
}
