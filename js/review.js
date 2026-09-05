// Gait Review: record a run with a clean screen, then play it back with the analysis on top.
//
// Pose detection runs live during capture (the phone has to decode the frames anyway), so the
// landmark track and the stride event log are ready the moment recording stops: no second pass
// over the video, no waiting. Only the video and a small landmark track are kept.
import { ASSETS, DEBUG } from './config.js';
import { createPose } from './pose.js';
import { LevelSensor } from './level.js';
import { Smoother, sideAngles, rearAngles, rearStance } from './gait.js';
import { analyzeTrack, frameScale, medianScale } from './analyze.js';
import { rotatePoints, rad, dist } from './geometry.js';
import { evaluate, standardsForView, asymmetry, fmt, STANDARD_BY_ID } from './standards.js';
import { drawSkeleton } from './draw.js';
import { SessionRecorder, formatBytes } from './recorder.js';
import { nearestEvent, phasesAt } from './track.js';

const $ = (id) => document.getElementById(id);
const ui = {
  setup: $('setup'), capture: $('capture'), review: $('review'),
  viewSelect: $('viewSelect'), lenSelect: $('lenSelect'), startBtn: $('startBtn'), status: $('status'),
  capFrame: $('capFrame'), camera: $('camera'), camOverlay: $('camOverlay'), countdown: $('countdown'),
  capLevel: $('capLevel'), capBubble: $('capBubble'), capLevelText: $('capLevelText'), trackChip: $('trackChip'),
  recDot: $('recDot'), recTime: $('recTime'), recFill: $('recFill'), stopBtn: $('stopBtn'), capHint: $('capHint'),
  revFrame: $('revFrame'), player: $('player'), revOverlay: $('revOverlay'),
  ticks: $('ticks'), seek: $('seek'), playBtn: $('playBtn'), prevEv: $('prevEv'), nextEv: $('nextEv'),
  stepBack: $('stepBack'), stepFwd: $('stepFwd'), timeLabel: $('timeLabel'), speed: $('speed'),
  now: $('now'), revFeedback: $('revFeedback'), revMetrics: $('revMetrics'),
  againBtn: $('againBtn'), clipInfo: $('clipInfo'),
};
const capCtx = ui.camOverlay.getContext('2d');
const revCtx = ui.revOverlay.getContext('2d');

const state = {
  phase: 'setup', view: 'side', maxMs: 40000,
  stream: null, pose: null, level: null, smoother: new Smoother(), scales: [],
  recorder: null, clip: null, raf: 0, frameMs: 33, capW: 0, capH: 0,
};

// ---------------- setup ----------------
ui.startBtn.addEventListener('click', begin);
ui.stopBtn.addEventListener('click', () => finish());
ui.againBtn.addEventListener('click', restart);

async function begin() {
  ui.startBtn.disabled = true;
  try {
    state.view = ui.viewSelect.value;
    state.maxMs = Number(ui.lenSelect.value) * 1000;
    setStatus('Requesting motion access for auto-level…');
    state.level = new LevelSensor();
    const levelOk = await state.level.start();
    setStatus('Starting camera…');
    await openCamera();
    if (!state.pose) state.pose = await createPose(ASSETS, { onStatus: setStatus });
    ui.setup.hidden = true; ui.capture.hidden = false;
    ui.capHint.textContent = levelOk ? '' : 'Motion sensor unavailable: auto-level off, hold the phone level.';
    state.phase = 'countdown';
    state.smoother.reset();
    loopCapture();
    await countdown(3);
    if (state.phase !== 'countdown') return; // stopped during the countdown
    startRecording();
  } catch (err) {
    showError(err);
    ui.startBtn.disabled = false;
  }
}

async function openCamera() {
  if (state.stream) state.stream.getTracks().forEach((t) => t.stop());
  state.stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 60 } },
  });
  ui.camera.srcObject = state.stream;
  await ui.camera.play();
}

function countdown(n) {
  return new Promise((resolve) => {
    ui.countdown.hidden = false;
    const tick = () => {
      if (state.phase !== 'countdown') { ui.countdown.hidden = true; return resolve(); }
      ui.countdown.textContent = n;
      if (n-- <= 0) { ui.countdown.hidden = true; return resolve(); }
      setTimeout(tick, 800);
    };
    tick();
  });
}

function startRecording() {
  state.scales = [];
  state.smoother.reset();
  state.recorder = new SessionRecorder({ maxMs: state.maxMs, onLimit: () => finish() });
  state.recorder.start(state.stream);
  state.phase = 'recording';
  ui.recDot.className = 'recdot on';
}

// ---------------- capture loop ----------------
function loopCapture() {
  const step = () => {
    if (state.phase !== 'countdown' && state.phase !== 'recording') return;
    drawCaptureFrame();
    state.raf = requestAnimationFrame(step);
  };
  state.raf = requestAnimationFrame(step);
}

function drawCaptureFrame() {
  const video = ui.camera;
  if (video.readyState < 2 || !video.videoWidth) return;
  const W = video.videoWidth, H = video.videoHeight;
  if (ui.camOverlay.width !== W) {
    ui.camOverlay.width = W; ui.camOverlay.height = H;
    ui.capFrame.style.aspectRatio = `${W} / ${H}`;
  }
  // The track is normalised, so the review pass has to rebuild pixels at the capture's own
  // aspect ratio; anything else stretches one axis and skews every angle.
  state.capW = W; state.capH = H;
  const now = performance.now();
  let det = { landmarks: null, world: null };
  try { det = state.pose.detect(video, now); } catch (err) { if (DEBUG) console.warn(err); }

  const roll = state.level?.available ? state.level.roll : 0;
  const raw = det.landmarks ? det.landmarks.map((p) => ({ x: p.x * W, y: p.y * H, v: p.visibility ?? 1 })) : null;
  const pts = state.smoother.apply(raw, now);

  if (state.phase === 'recording' && state.recorder) {
    state.recorder.addFrame(det.landmarks, roll);
    if (pts && det.world) {
      // Metric scale is only available live, from the world landmarks; keep it for the review pass.
      const legPx = (dist(pts[23], pts[25]) + dist(pts[25], pts[27]) + dist(pts[24], pts[26]) + dist(pts[26], pts[28])) / 2;
      const sc = frameScale(det.world, legPx);
      if (sc) state.scales.push(sc);
    }
    renderRecProgress();
  }

  // Deliberately sparse: outline only, so nothing competes with the runner while they are running.
  capCtx.clearRect(0, 0, W, H);
  if (pts) drawSkeleton(capCtx, pts, null, { view: state.view });
  const tracking = isTracked(pts);
  ui.trackChip.textContent = tracking ? 'Tracking' : 'Looking for a runner';
  ui.trackChip.className = `chip ${tracking ? 'live' : 'muted'}`;
  renderLevel();
}

const CORE = [11, 12, 23, 24, 25, 26, 27, 28];
const isTracked = (P) => !!P && CORE.every((i) => (P[i].v ?? 1) > 0.5);

function renderRecProgress() {
  const ms = state.recorder.elapsedMs;
  ui.recTime.textContent = `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
  ui.recFill.style.width = `${Math.min(100, (ms / state.maxMs) * 100)}%`;
}

function renderLevel() {
  const lv = state.level;
  if (!lv?.available) { ui.capLevelText.textContent = 'no level'; ui.capLevel.className = 'level na'; return; }
  ui.capBubble.style.transform = `translateX(${Math.max(-1, Math.min(1, lv.roll / 15)) * 40}px)`;
  const ok = Math.abs(lv.roll) < 2 && Math.abs(lv.pitch) < 8;
  ui.capLevel.className = `level ${ok ? 'ok' : 'warn'}`;
  const pitch = Math.abs(lv.pitch) >= 8 ? ` · tilted ${lv.pitch > 0 ? 'up' : 'down'} ${Math.abs(lv.pitch).toFixed(0)}°` : '';
  ui.capLevelText.textContent = `${lv.roll >= 0 ? '↻' : '↺'} ${Math.abs(lv.roll).toFixed(1)}°${pitch}`;
}

// ---------------- stop and hand over to review ----------------
async function finish() {
  if (state.phase !== 'recording' && state.phase !== 'countdown') return;
  const wasRecording = state.phase === 'recording';
  state.phase = 'analyzing';
  cancelAnimationFrame(state.raf);
  ui.recDot.className = 'recdot idle';
  if (!wasRecording || !state.recorder) return restart();

  const { url, wallMs, track, blob } = await state.recorder.stop();
  state.stream.getTracks().forEach((t) => t.stop()); state.stream = null;
  state.level?.stop();

  if (!track.length || !url) {
    showError(new Error('Nothing was recorded. Try again with the runner fully in frame.'));
    return restart();
  }

  // Second pass over the recorded track: deterministic, and more accurate than the live pass.
  const { events, metrics, dir } = analyzeTrack(track, {
    view: state.view, width: state.capW || 1280, height: state.capH || 720, mPerPx: medianScale(state.scales),
  });
  const clip = { url, track, blob, events, metrics, dir, view: state.view, durationMs: wallMs };
  state.clip = clip;
  ui.capture.hidden = true; ui.review.hidden = false;
  state.phase = 'review';
  await loadPlayer(clip);
}

/** Fit the landmark track to the encoded video's real duration, then wire up the review screen. */
async function loadPlayer(clip) {
  ui.player.src = clip.url;
  const durMs = await videoDuration(ui.player, clip.durationMs);
  const base = clip.durationMs || clip.track.duration || durMs;
  const factor = base > 0 ? durMs / base : 1;
  // Guard against a bogus duration: only correct modest drift between wall clock and encoder.
  if (factor > 0.5 && factor < 2 && Math.abs(factor - 1) > 0.01) {
    clip.track.rescale(factor);
    for (const e of clip.events) e.t *= factor;
  }
  clip.durationMs = durMs;

  const ts = clip.track.ts;
  state.frameMs = ts.length > 1 ? Math.max(10, (ts[ts.length - 1] - ts[0]) / (ts.length - 1)) : 33;

  const W = ui.player.videoWidth || 1280, H = ui.player.videoHeight || 720;
  ui.revOverlay.width = W; ui.revOverlay.height = H;
  ui.revFrame.style.aspectRatio = `${W} / ${H}`;

  const rows = evaluate(clip.metrics, clip.view);
  renderFeedback(rows); renderMetrics(rows);
  renderTicks(clip);
  ui.clipInfo.textContent = `${(durMs / 1000).toFixed(1)} s · ${clip.track.length} analysed frames · ${formatBytes((clip.blob?.size ?? 0) + clip.track.bytes)} in memory`;
  ui.player.playbackRate = Number(ui.speed.value);
  seekTo(0);
}

/** Safari reports Infinity for a MediaRecorder blob until it is seeked; fall back to the wall clock. */
function videoDuration(video, fallbackMs) {
  return new Promise((resolve) => {
    let done = false;
    const finishWith = (ms) => { if (!done) { done = true; resolve(ms); } };
    const check = () => {
      const d = video.duration;
      if (Number.isFinite(d) && d > 0) { video.currentTime = 0; finishWith(d * 1000); }
    };
    video.addEventListener('durationchange', check);
    video.addEventListener('loadedmetadata', () => {
      if (Number.isFinite(video.duration) && video.duration > 0) return finishWith(video.duration * 1000);
      video.currentTime = 1e6; // forces Safari to resolve the real duration
    });
    setTimeout(() => finishWith(fallbackMs), 2500);
  });
}

// ---------------- playback ----------------
const clipDur = () => state.clip?.durationMs ?? 0;

ui.playBtn.addEventListener('click', () => (ui.player.paused ? ui.player.play() : ui.player.pause()));
ui.player.addEventListener('play', () => { ui.playBtn.textContent = '❚❚'; drawLoop(); });
ui.player.addEventListener('pause', () => { ui.playBtn.textContent = '▶'; });
ui.player.addEventListener('ended', () => { ui.playBtn.textContent = '▶'; });
ui.player.addEventListener('seeked', () => renderFrame()); // no arg: the Event is not a timestamp
ui.speed.addEventListener('change', () => { ui.player.playbackRate = Number(ui.speed.value); });
ui.seek.addEventListener('input', () => seekTo((Number(ui.seek.value) / 1000) * clipDur()));
ui.stepBack.addEventListener('click', () => stepFrame(-1));
ui.stepFwd.addEventListener('click', () => stepFrame(1));
ui.prevEv.addEventListener('click', () => jumpEvent(-1));
ui.nextEv.addEventListener('click', () => jumpEvent(1));

function drawLoop() {
  renderFrame();
  if (!ui.player.paused && !ui.player.ended) requestAnimationFrame(drawLoop);
}

function seekTo(ms) {
  const t = Math.max(0, Math.min(clipDur(), ms));
  ui.player.currentTime = t / 1000;
  renderFrame(t);
}

function stepFrame(n) {
  ui.player.pause();
  seekTo(ui.player.currentTime * 1000 + n * state.frameMs);
}

function jumpEvent(dir) {
  const evs = state.clip?.events ?? [];
  if (!evs.length) return;
  const t = ui.player.currentTime * 1000;
  const sorted = [...evs].sort((a, b) => a.t - b.t);
  const next = dir > 0 ? sorted.find((e) => e.t > t + 15) : [...sorted].reverse().find((e) => e.t < t - 15);
  if (next) { ui.player.pause(); seekTo(next.t); }
}

function renderFrame(forcedMs) {
  const clip = state.clip;
  if (!clip) return;
  const t = Number.isFinite(forcedMs) ? forcedMs : ui.player.currentTime * 1000;
  const W = ui.revOverlay.width, H = ui.revOverlay.height;
  revCtx.clearRect(0, 0, W, H);

  const P = clip.track.pointsAt(t, W, H);
  if (P) {
    // Angles are measured on level-corrected points; the skeleton is drawn on the raw ones,
    // because the video itself is tilted by exactly the same amount.
    const lev = rotatePoints(P, W / 2, H / 2, rad(clip.track.rollAt(t)));
    revCtx.save();
    drawSkeleton(revCtx, P, angleOverlay(lev, clip), { view: clip.view });
    revCtx.restore();
  }
  ui.seek.value = clipDur() ? String(Math.round((t / clipDur()) * 1000)) : '0';
  ui.timeLabel.textContent = `${(t / 1000).toFixed(2)} / ${(clipDur() / 1000).toFixed(2)} s`;
  renderNow(t, P);
}

function angleOverlay(lev, clip) {
  try {
    if (clip.view === 'side') return { dir: clip.dir, ...sideAngles(lev, clip.dir) };
    const legLen = (dist(lev[23], lev[25]) + dist(lev[25], lev[27]) + dist(lev[24], lev[26]) + dist(lev[26], lev[28])) / 2;
    return rearAngles(lev, legLen > 1 ? rearStance(lev, legLen) : null);
  } catch {
    return null;
  }
}

/** The strip under the transport: which phase each leg is in, and any event at the playhead. */
function renderNow(t, P) {
  const clip = state.clip;
  const ev = nearestEvent(clip.events, t, 120);
  const parts = [];
  if (ev) {
    const name = ev.type === 'IC' ? 'Initial contact' : ev.type === 'TO' ? 'Toe-off' : 'Stance';
    parts.push(`<span class="ev ${ev.side}">${ev.side === 'L' ? 'Left' : 'Right'} · ${name}</span>`);
    for (const [id, v] of Object.entries(ev.values)) {
      const s = STANDARD_BY_ID[id];
      if (!s) continue;
      const [lo, hi] = s.target;
      const cls = v < lo || v > hi ? (Math.max(lo - v, v - hi) >= s.tol ? 'bad' : 'warn') : 'ok';
      parts.push(`<span class="pill ${cls}">${s.label} ${fmt(s, v)}</span>`);
    }
  } else if (clip.view === 'side') {
    const ph = phasesAt(clip.events, t);
    const label = (side) => `<span class="pill">${side === 'L' ? 'Left' : 'Right'} ${ph[side] ?? '–'}</span>`;
    parts.push(label('L'), label('R'));
    if (!P) parts.push('<span class="idle">no runner detected in this frame</span>');
  } else if (!P) {
    parts.push('<span class="idle">no runner detected in this frame</span>');
  }
  ui.now.innerHTML = parts.join('') || '<span class="idle">between strides</span>';
}

function renderTicks(clip) {
  const dur = clip.durationMs || 1;
  // Foot contacts only: at 180 spm a 40 s clip has 240 events, and drawing them all is a solid bar.
  const ics = clip.events.filter((e) => e.type === 'IC' && e.t >= 0 && e.t <= dur);
  ui.ticks.classList.toggle('dense', ics.length > 45);
  ui.ticks.innerHTML = ics
    .map((e) => `<span class="tick ${e.side}" style="left:${(e.t / dur) * 100}%" title="${e.side} contact"></span>`)
    .join('');
}

// ---------------- panels ----------------
function renderFeedback(rows) {
  const measured = rows.filter((r) => r.status !== 'na');
  if (!measured.length) {
    ui.revFeedback.innerHTML = '<div class="card wait"><h3>No complete strides found</h3><p>The whole body has to stay in frame, head to feet, for a few strides. Check the framing and record again.</p></div>';
    return;
  }
  const issues = rows.filter((r) => r.severity > 0).slice(0, 3);
  const good = measured.filter((r) => r.status === 'ok');
  let html = issues.map((r) => `
    <div class="card ${r.severity >= 1 ? 'bad' : 'warn'}">
      <h3>${r.cue}</h3>
      <p><b>${r.label}: ${fmt(r)}</b> · target ${r.target[0]}–${r.target[1]}${r.unit === '°' ? '°' : ' ' + r.unit}</p>
      <p>${r.message}</p>
      ${asymmetry(r) ? `<p class="asym">${asymmetry(r)}</p>` : ''}
    </div>`).join('');
  if (good.length) html += `<div class="card ok"><h3>${issues.length ? 'Within range' : 'Form within reference ranges'}</h3><p>${good.map((r) => r.label).join(' · ')}</p></div>`;
  ui.revFeedback.innerHTML = html;
}

function renderMetrics(rows) {
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  ui.revMetrics.innerHTML = standardsForView(state.view).map((s) => {
    const r = byId[s.id];
    const dot = !r || r.status === 'na' ? 'na' : r.status === 'ok' ? 'ok' : r.severity >= 1 ? 'bad' : 'warn';
    const lr = r && r.L != null && r.R != null ? `<span class="lr">L ${fmt(r, r.L)} · R ${fmt(r, r.R)}</span>` : '';
    return `<div class="metric"><span class="dot ${dot}"></span><span class="name">${s.label}</span><span class="val">${r ? fmt(r) : '–'}</span>${lr}<span class="tgt">${s.target[0]}–${s.target[1]}${s.unit === '°' ? '°' : ' ' + s.unit}</span></div>`;
  }).join('');
}

// ---------------- lifecycle ----------------
function restart() {
  cancelAnimationFrame(state.raf);
  ui.player.pause(); ui.player.removeAttribute('src'); ui.player.load();
  state.recorder?.dispose();
  state.stream?.getTracks().forEach((t) => t.stop());
  state.stream = null; state.clip = null; state.recorder = null; state.analyzer = null;
  state.level?.stop(); state.level = null;
  state.phase = 'setup';
  ui.review.hidden = true; ui.capture.hidden = true; ui.setup.hidden = false;
  ui.startBtn.disabled = false;
  ui.recFill.style.width = '0'; ui.recTime.textContent = '0:00';
  setStatus('');
}

function setStatus(msg) { ui.status.textContent = msg; ui.status.classList.remove('error'); }
function showError(err) {
  console.error(err);
  const msg = err?.name === 'NotAllowedError' ? 'Camera access was denied. Allow camera access in Settings › Safari and reload.'
    : err?.name === 'NotFoundError' ? 'No camera found.'
    : `Could not start: ${err?.message ?? err}`;
  ui.status.textContent = msg; ui.status.classList.add('error');
}

document.addEventListener('visibilitychange', () => { if (document.hidden && state.phase === 'recording') finish(); });

if (DEBUG) window.__review = state;
