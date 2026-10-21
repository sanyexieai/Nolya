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
export function shareTitle(kind: ShareKind) {
  return kind === "self"
    ? "自己眼中的我，是这样的"
    : kind === "mirror"
      ? "同一个我，发现了新的视角"
      : kind === "friend"
        ? "认识你的人，会觉得你怎么选？"
        : kind === "reverse"
          ? "这一回，换你猜猜我的选择"
          : "一个真实选择，你猜得到吗？";
}
export function defaultShareText(kind: ShareKind) {
  if (kind === "self" || kind === "mirror")
    return "在 Nolya，从不同视角认识自己。这是一次小发现，不是对我的定义。";
  return kind === "friend"
    ? "同一个我，不同的视角。选 3 道生活情境题，让我看看你眼中的我。约 30 秒，无需注册。"
    : kind === "reverse"
      ? "刚才是我猜你，这一回换你来猜。只发给刚才邀请我的那位朋友，提交后再揭晓答案。"
      : "我在 Nolya 留下了一个真实选择。凭直觉猜一猜，提交后再揭晓。不是考试，只是多了解彼此一点。";
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
export async function renderSharePoster(
  kind: ShareKind,
  value: string,
  caption: string,
  platform: SharePlatform,
): Promise<string> {
  const url = checkedShareUrl(value);
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
  ctx.fillText("同一个你，不同的视角", 100, 203);
  ctx.font = "bold 60px sans-serif";
  ctx.fillStyle = "#171531";
  const titleLines = wrapPosterText(
    shareTitle(kind),
    (line) => ctx.measureText(line).width,
    width - 200,
  );
  titleLines.forEach((line, i) => ctx.fillText(line, 100, 305 + i * 82));
  const captionStart = 350 + titleLines.length * 82;
  ctx.font = "32px sans-serif";
  ctx.fillStyle = "#4C415E";
  const captionLines = wrapPosterText(
    caption.trim(),
    (line) => ctx.measureText(line).width,
    width - 200,
  );
  const qrSize = 280;
  const qrTop = height - 445;
  const maxLines = Math.max(
    1,
    Math.min(3, Math.floor((qrTop - 55 - captionStart) / 46)),
  );
  const displayLines = captionLines.slice(0, maxLines);
  if (captionLines.length > maxLines)
    displayLines[maxLines - 1] =
      Array.from(displayLines[maxLines - 1])
        .slice(0, -1)
        .join("") + "…";
  displayLines.forEach((line, i) =>
    ctx.fillText(line, 100, captionStart + i * 46),
  );
  // Two perspective cards echo the source design's layered, pastel mirror motif.
  // Never draw account identity, answer choices or individual friend data.
  const motifStart = captionStart + displayLines.length * 46 + 36;
  const motifSpace = qrTop - motifStart - 45;
  const motifHeight = Math.min(440, motifSpace);
  const motifTop = motifStart + Math.max(0, (motifSpace - motifHeight) / 2);
  if (motifHeight >= 150) {
    const cardWidth = 408;
    ["自己眼中的我", "朋友眼中的我"].forEach((label, index) => {
      const x = index === 0 ? 100 : 572;
      ctx.fillStyle = index === 0 ? "#F0EBFF" : "#FFE8D9";
      ctx.beginPath();
      ctx.roundRect(x, motifTop, cardWidth, motifHeight, 32);
      ctx.fill();
      ctx.fillStyle = index === 0 ? "#6B57FF" : "#B65C43";
      const radius = Math.min(76, motifHeight * 0.23);
      const centerY = motifTop + motifHeight * 0.4;
      ctx.beginPath();
      ctx.arc(
        x + cardWidth / 2 - radius * 0.45,
        centerY,
        radius,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      ctx.fillStyle = index === 0 ? "#C6B8FF" : "#F6BD9F";
      ctx.beginPath();
      ctx.arc(
        x + cardWidth / 2 + radius * 0.45,
        centerY,
        radius,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      ctx.fillStyle = "#39264F";
      ctx.font = "600 28px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(label, x + cardWidth / 2, motifTop + motifHeight - 30);
    });
    ctx.textAlign = "left";
  }
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
