import * as THREE from "three";
import { canvasTex } from "../engine/geometry";

/** Room sign: division name on a dark plate. */
export function signTexture(text: string, color: string): THREE.CanvasTexture {
  return canvasTex(512, 128, (ctx) => {
    ctx.fillStyle = "#1B1D22";
    ctx.fillRect(0, 0, 512, 128);
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 18, 128);
    ctx.fillStyle = "#F4F4F2";
    ctx.font = "600 44px system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(fit(ctx, text, 460), 40, 66);
  });
}

function fit(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + "…").width > maxW) t = t.slice(0, -1);
  return t + "…";
}

export type BoardInfo = { name: string; countdown: string; phase: string; health: string | null };

/** Event board: name, countdown, phase, health colour bar. Redrawn once per second. */
export function drawBoard(ctx: CanvasRenderingContext2D, info: BoardInfo): void {
  ctx.fillStyle = "#15171B";
  ctx.fillRect(0, 0, 512, 320);
  const bar = info.health === "critical" ? "#D43F2F" : info.health === "at_risk" ? "#E0A426" : "#3FA46B";
  ctx.fillStyle = bar;
  ctx.fillRect(0, 0, 512, 14);
  ctx.fillStyle = "#F4F4F2";
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  ctx.font = "600 40px system-ui, sans-serif";
  ctx.fillText(fit(ctx, info.name, 470), 24, 36);
  ctx.font = "500 92px ui-monospace, monospace";
  ctx.fillText(info.countdown, 24, 110);
  ctx.font = "400 30px system-ui, sans-serif";
  ctx.fillStyle = "#B9BCC3";
  ctx.fillText(fit(ctx, info.phase, 470), 24, 240);
}

export function boardTexture(): { tex: THREE.CanvasTexture; ctx: CanvasRenderingContext2D } {
  const cv = document.createElement("canvas");
  cv.width = 512;
  cv.height = 320;
  const ctx = cv.getContext("2d")!;
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return { tex, ctx };
}

/** "D-12 · 04:11:09" style countdown to a show date, or a label when past/unknown. */
export function countdownLabel(showDate: string | null, now: Date): string {
  if (!showDate) return "TBD";
  const ms = new Date(showDate).getTime() - now.getTime();
  if (Number.isNaN(ms)) return "TBD";
  if (ms <= 0) return "SHOW DAY";
  const days = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `D-${days} ${p(h)}:${p(m)}:${p(s)}`;
}
