// Skeleton overlay: segment lines (foot, shin, thigh, trunk, upper arm, forearm), joint markers,
// live joint angles, and the gravity horizon from the level sensor.
import { rad, mid } from './geometry.js';

const SEGMENTS = [
  [11, 12], [11, 23], [12, 24], [23, 24],           // trunk
  [11, 13], [13, 15], [12, 14], [14, 16],           // upper arm, forearm
  [23, 25], [25, 27], [24, 26], [26, 28],           // thigh, shin
  [27, 29], [29, 31], [27, 31], [28, 30], [30, 32], [28, 32], // foot
];
const JOINTS = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32];
const LEFT = new Set([11, 13, 15, 23, 25, 27, 29, 31]);
const RIGHT = new Set([12, 14, 16, 24, 26, 28, 30, 32]);
const COLOR = { left: '#37e5d8', right: '#ff9f43', trunk: '#f4f6f8' };
const MIN_VIS = 0.5;

const vis = (p) => p && (p.v ?? 1) > MIN_VIS;

export function drawSkeleton(ctx, P, live, { mirror = false, view = 'side' } = {}) {
  const W = ctx.canvas.width;
  const lw = Math.max(2, W / 260);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';

  for (const [a, b] of SEGMENTS) {
    if (!vis(P[a]) || !vis(P[b])) continue;
    ctx.strokeStyle = LEFT.has(a) && LEFT.has(b) ? COLOR.left : RIGHT.has(a) && RIGHT.has(b) ? COLOR.right : COLOR.trunk;
    ctx.lineWidth = lw;
    ctx.beginPath(); ctx.moveTo(P[a].x, P[a].y); ctx.lineTo(P[b].x, P[b].y); ctx.stroke();
  }
  for (const i of JOINTS) {
    if (!vis(P[i])) continue;
    ctx.fillStyle = LEFT.has(i) ? COLOR.left : COLOR.right;
    ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = lw * 0.5;
    ctx.beginPath(); ctx.arc(P[i].x, P[i].y, lw * 1.7, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }

  if (!live) return;
  const fs = Math.max(12, W / 34);
  const label = (p, text, dx = 0) => vis(p) && drawLabel(ctx, p.x + dx, p.y, text, fs, mirror);
  if (view === 'side') {
    const ahead = (live.dir ?? 1) * fs * 1.2;
    label(P[25], `${live.kneeL.toFixed(0)}°`, -ahead);
    label(P[26], `${live.kneeR.toFixed(0)}°`, -ahead);
    label(P[13], `${live.elbowL.toFixed(0)}°`, -ahead);
    label(P[14], `${live.elbowR.toFixed(0)}°`, -ahead);
    if (vis(P[11]) && vis(P[12])) label(mid(P[11], P[12]), `lean ${live.trunk.toFixed(0)}°`, 0);
  } else {
    if (vis(P[23]) && vis(P[24]) && live.drop != null) label(mid(P[23], P[24]), `drop ${live.drop.toFixed(0)}°`);
    if (live.stance) {
      const knee = live.stance === 'L' ? P[25] : P[26];
      if (live.valgus != null) label(knee, `valgus ${live.valgus.toFixed(0)}°`, fs * 1.5);
    }
    if (vis(P[11]) && vis(P[12])) label(mid(P[11], P[12]), `sway ${live.trunkLat.toFixed(0)}°`);
  }
}

function drawLabel(ctx, x, y, text, fs, mirror) {
  ctx.save();
  ctx.translate(x, y);
  if (mirror) ctx.scale(-1, 1);
  ctx.font = `600 ${fs}px -apple-system, system-ui, sans-serif`;
  ctx.textBaseline = 'middle';
  const w = ctx.measureText(text).width + fs * 0.6, h = fs * 1.35;
  ctx.fillStyle = 'rgba(8,12,18,.72)';
  roundRect(ctx, -w / 2, -h / 2, w, h, fs * 0.35); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
  ctx.fillText(text, 0, 1);
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

/** True-horizontal reference line. With the phone rolled clockwise by θ, the world's horizon appears rotated counter-clockwise by θ. */
export function drawHorizon(ctx, W, H, rollDeg) {
  const th = rad(rollDeg);
  const dx = Math.cos(th), dy = -Math.sin(th);
  const cx = W / 2, cy = H / 2, len = W * 0.42;
  ctx.save();
  ctx.strokeStyle = Math.abs(rollDeg) < 2 ? 'rgba(61,220,132,.8)' : 'rgba(255,176,32,.9)';
  ctx.lineWidth = Math.max(1.5, W / 500);
  ctx.setLineDash([W / 60, W / 90]);
  ctx.beginPath();
  ctx.moveTo(cx - dx * len, cy - dy * len); ctx.lineTo(cx - dx * len * 0.25, cy - dy * len * 0.25);
  ctx.moveTo(cx + dx * len * 0.25, cy + dy * len * 0.25); ctx.lineTo(cx + dx * len, cy + dy * len);
  ctx.stroke();
  ctx.restore();
}
