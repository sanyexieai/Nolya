import QRCode from "qrcode";
export type ShareKind = "friend" | "guess" | "reverse" | "self" | "mirror";
export type SharePlatform =
  "wechat" | "moments" | "douyin" | "xiaohongshu" | "more";
export const sharePlatforms: {
  id: SharePlatform;
  name: string;
  width: number;
  height: number;
  guide: string;
}[] = [
  {
    id: "wechat",
    name: "微信好友",
    width: 1080,
    height: 1440,
    guide:
      "复制邀请链接，在微信中选择一位熟悉你的朋友粘贴发送；也可以保存海报后发送图片。请复制下方专属链接，不要转发当前管理或创建页面。",
  },
  {
    id: "moments",
    name: "朋友圈",
    width: 1080,
    height: 1080,
    guide:
      "保存方形海报，复制文案，在微信朋友圈中选择图片并粘贴文案。请留意可见范围，任何获得普通邀请链接的人都可能参与。",
  },
  {
    id: "douyin",
    name: "抖音",
    width: 1080,
    height: 1920,
    guide:
      "保存竖版海报，复制文案，打开抖音后手动选择图片创作并确认发布。当前未接入抖音开放平台直分享；外链和二维码是否可展示以平台规则为准。",
  },
  {
    id: "xiaohongshu",
    name: "小红书",
    width: 1080,
    height: 1440,
    guide:
      "保存 3:4 海报，复制文案，在小红书中选择图片并手动粘贴、编辑后发布。当前未接入平台直分享；外链和二维码使用请遵守平台规则。",
  },
  {
    id: "more",
    name: "更多 / 系统",
    width: 1080,
    height: 1440,
    guide:
      "由系统分享面板选择可用应用。应用列表取决于设备；若没有目标应用，可复制链接或保存海报后自行发送。",
  },
];
export function shareContextLabel(kind: ShareKind) {
  return {
    friend: "朋友反馈邀请",
    guess: "猜答案邀请",
    reverse: "定向反向邀请",
    self: "自我评估",
    mirror: "镜像对比",
  }[kind];
}
export function shareTitle(kind: ShareKind) {
  return kind === "self"
    ? "我的自我评估结果"
    : kind === "mirror"
      ? "我的镜像对比结果"
      : kind === "friend"
        ? "邀请朋友答 3 道题"
        : kind === "reverse"
          ? "请原邀请人猜答案"
          : "邀请朋友猜我的答案";
}
export function defaultShareText(kind: ShareKind) {
  if (kind === "self" || kind === "mirror")
    return "这是我在 Nolya 的评估结果摘要。扫码可打开应用，不包含我的个人结果。";
  return kind === "friend"
    ? "请回答 3 道生活情境题，帮助我了解你对我的看法。约 30 秒，无需注册。"
    : kind === "reverse"
      ? "这是给原邀请人的反向邀请。请猜我的答案，提交后查看结果。"
      : "请根据你对我的了解猜一道题。提交猜测后，可以查看我预先保存的答案。";
}
export function checkedShareUrl(value: string): URL {
  const url = new URL(value);
  if (
    !/^https?:$/.test(url.protocol) ||
    url.username ||
    url.password ||
    value.length > 2048
  )
    throw new Error("邀请链接无效，请重新生成。");
  return url;
}
export function isLocalShareUrl(value: string): boolean {
  const host = checkedShareUrl(value).hostname.toLowerCase();
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host === "[::1]" ||
    host === "[::]" ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^\[(?:fc|fd|fe80:)/.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host === "0.0.0.0"
  );
}
export function copyPayload(caption: string, value: string) {
  checkedShareUrl(value);
  return `${caption.trim()}\n${value}`;
}
export function wrapPosterText(
  text: string,
  measure: (value: string) => number,
  maxWidth: number,
): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const character of Array.from(paragraph)) {
      if (line && measure(line + character) > maxWidth) {
        lines.push(line);
        line = character;
      } else line += character;
    }
    lines.push(line);
  }
  return lines;
}
export function pngFile(dataUrl: string): File {
  if (!dataUrl.startsWith("data:image/png;base64,"))
    throw new Error("海报格式不正确。");
  const bytes = Uint8Array.from(atob(dataUrl.split(",")[1]), (char) =>
    char.charCodeAt(0),
  );
  return new File([bytes], "nolya-invitation.png", { type: "image/png" });
}
export const shareArtwork: Record<ShareKind, string> = {
  friend: "/design/ambassador-cafe.jpg",
  guess: "/design/guess-outdoor.png",
  reverse: "/design/reverse-start-outdoor.png",
  self: "/design/self-result-mobile.jpg",
  mirror: "/design/full-mirror-main.jpg",
};
export function posterPhotoLayout(height: number) {
  return height === 1080
    ? { x: 100, y: 240, width: 390, height: 350 }
    : { x: 100, y: 230, width: 880, height: height - 960 };
}
export function coverSourceRect(
  width: number,
  height: number,
  boxWidth: number,
  boxHeight: number,
) {
  const scale = Math.max(boxWidth / width, boxHeight / height);
  const w = boxWidth / scale,
    h = boxHeight / scale;
  return { x: (width - w) / 2, y: (height - h) * 0.28, width: w, height: h };
}
export function loadShareArtwork(
  kind: ShareKind,
  signal?: AbortSignal,
): Promise<HTMLImageElement> {
  const url = new URL(shareArtwork[kind], window.location.origin);
  if (url.origin !== window.location.origin)
    return Promise.reject(new Error("仅可使用同源品牌图片。"));
  return new Promise((resolve, reject) => {
    const photo = document.createElement("img");
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      photo.onload = null;
      photo.onerror = null;
      signal?.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve(photo);
    };
    const abort = () => finish(new DOMException("取消图片生成", "AbortError"));
    const timer = setTimeout(
      () => finish(new Error("品牌图片加载超时，请重试。")),
      12000,
    );
    photo.onload = async () => {
      try {
        if (typeof photo.decode === "function") await photo.decode();
        if (!photo.naturalWidth || !photo.naturalHeight)
          throw new Error("图片尺寸无效");
        finish();
      } catch {
        finish(new Error("品牌图片无法解码，请重试。"));
      }
    };
    photo.onerror = () => finish(new Error("品牌图片加载失败，请重试。"));
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) {
      abort();
      return;
    }
    photo.src = url.href;
  });
}
export async function renderSharePoster(
  kind: ShareKind,
  value: string,
  caption: string,
  platform: SharePlatform,
  signal?: AbortSignal,
): Promise<string> {
  const url = checkedShareUrl(value);
  const photo = await loadShareArtwork(kind, signal);
  const format = sharePlatforms.find((item) => item.id === platform)!;
  const canvas = document.createElement("canvas");
  canvas.width = format.width;
  canvas.height = format.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("此浏览器无法生成海报，请复制链接分享。");
  const { width, height } = canvas;
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "#F5F1FF");
  gradient.addColorStop(1, "#FFF3EB");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#FFFFFF";
  ctx.beginPath();
  ctx.roundRect(48, 48, width - 96, height - 96, 48);
  ctx.fill();
  ctx.fillStyle = "#6B57FF";
  ctx.font = "800 64px sans-serif";
  ctx.fillText("Nolya", 100, 150);
  ctx.fillStyle = "#645578";
  ctx.font = "24px sans-serif";
  ctx.fillText(shareContextLabel(kind), 100, 203);
  ctx.font = "21px sans-serif";
  ctx.fillText("品牌示意图 · 非用户照片", 660, 203);
  const box = posterPhotoLayout(height);
  const crop = coverSourceRect(
    photo.naturalWidth,
    photo.naturalHeight,
    box.width,
    box.height,
  );
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(box.x, box.y, box.width, box.height, 32);
  ctx.clip();
  ctx.drawImage(
    photo,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    box.x,
    box.y,
    box.width,
    box.height,
  );
  ctx.restore();
  const square = height === 1080;
  const textX = square ? 530 : 100;
  const textWidth = square ? 450 : 880;
  const titleStart = square ? 292 : box.y + box.height + 65;
  const titleStep = square ? 66 : 70;
  ctx.font = square ? "bold 50px sans-serif" : "bold 56px sans-serif";
  ctx.fillStyle = "#171531";
  const titleLines = wrapPosterText(
    shareTitle(kind),
    (line) => ctx.measureText(line).width,
    textWidth,
  );
  titleLines.forEach((line, i) =>
    ctx.fillText(line, textX, titleStart + i * titleStep),
  );
  const captionStart = titleStart + (titleLines.length - 1) * titleStep + 50;
  ctx.font = square ? "28px sans-serif" : "30px sans-serif";
  ctx.fillStyle = "#4C415E";
  const captionLines = wrapPosterText(
    caption.trim(),
    (line) => ctx.measureText(line).width,
    textWidth,
  );
  const qrSize = 280;
  const qrTop = height - 445;
  const maxLines = Math.max(
    1,
    Math.min(square ? 4 : 2, Math.floor((qrTop - 48 - captionStart) / 42) + 1),
  );
  const displayLines = captionLines.slice(0, maxLines);
  if (captionLines.length > maxLines)
    displayLines[maxLines - 1] =
      Array.from(displayLines[maxLines - 1])
        .slice(0, -1)
        .join("") + "…";
  displayLines.forEach((line, i) =>
    ctx.fillText(line, textX, captionStart + i * 42),
  );
  const qr = document.createElement("canvas");
  await QRCode.toCanvas(qr, value, {
    width: qrSize,
    margin: 4,
    errorCorrectionLevel: "M",
    color: { dark: "#171531", light: "#FFFFFF" },
  });
  ctx.drawImage(qr, (width - qrSize) / 2, qrTop, qrSize, qrSize);
  ctx.textAlign = "center";
  ctx.font = "28px sans-serif";
  ctx.fillStyle = "#4C415E";
  ctx.fillText(
    kind === "self" || kind === "mirror"
      ? "扫码体验 Nolya，不含个人结果"
      : kind === "reverse"
        ? "仅限原邀请人扫码参与"
        : "扫码打开邀请，自愿参与",
    width / 2,
    height - 125,
  );
  ctx.font = "22px sans-serif";
  const origin =
    url.origin.length > 60 ? `${url.origin.slice(0, 57)}…` : url.origin;
  ctx.fillText(origin, width / 2, height - 86);
  if (signal?.aborted) throw new DOMException("取消图片生成", "AbortError");
  return canvas.toDataURL("image/png");
}
export function invitationShareKind(
  kind: "friend" | "guess",
  source?: { source_type?: string; is_directed?: boolean },
): ShareKind {
  return kind === "guess" &&
    (source?.source_type === "reverse" || source?.is_directed)
    ? "reverse"
    : kind;
}
