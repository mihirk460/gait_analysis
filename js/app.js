import { ASSETS, DEBUG } from './config.js';
import { createPose } from './pose.js';
import { LevelSensor } from './level.js';
import { Smoother, GaitAnalyzer, DRAW_ALPHA, ANALYSIS_ALPHA } from './gait.js';
import { rotatePoints, rad } from './geometry.js';
import { evaluate, standardsForView, asymmetry, fmt } from './standards.js';
import { drawSkeleton, drawHorizon } from './draw.js';

const $ = (id) => document.getElementById(id);
const ui = {
  start: $('start'), app: $('app'), startBtn: $('startBtn'), status: $('status'),
  viewSelect: $('viewSelect'), voiceCheck: $('voiceCheck'),
  video: $('video'), canvas: $('overlay'),
  levelBox: $('level'), bubble: $('bubble'), levelText: $('levelText'), fps: $('fps'),
  flipBtn: $('flipBtn'), viewBtn: $('viewBtn'), voiceBtn: $('voiceBtn'), stopBtn: $('stopBtn'),
  feedback: $('feedback'), metrics: $('metrics'), hint: $('hint'),
};
const ctx = ui.canvas.getContext('2d');

const state = {
  running: false, facing: 'environment', view: 'side', voice: true,
  stream: null, pose: null, level: new LevelSensor(),
  // Two filters over the same landmarks: a heavy one so the drawn skeleton is steady, and a
  // near-raw one for measurement, because smoothing lags the true position and biases every
  // angle sampled at a single instant (foot contact, toe-off).
  drawSmoother: new Smoother(DRAW_ALPHA), analysisSmoother: new Smoother(ANALYSIS_ALPHA),
  analyzer: new GaitAnalyzer({ view: 'side' }), fps: 0, lastFrameT: 0, lastUiT: 0, lastLevelT: 0,
};

// ---------------- voice coaching ----------------
const coach = {
  lastT: 0, lastCue: null,
  speak(text) {
    if (!('speechSynthesis' in window)) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.05; u.lang = 'en-US';
    speechSynthesis.speak(u);
  },
  tick(rows, now) {
    if (!state.voice) return;
    const top = rows.find((r) => r.severity >= 0.3 && r.cue);
    if (top) {
      const gap = top.cue === this.lastCue ? 12000 : 6000;
      if (now - this.lastT > gap) { this.speak(top.cue); this.lastT = now; this.lastCue = top.cue; }
    } else if (rows.filter((r) => r.status === 'ok').length >= 4 && now - this.lastT > 30000) {
      this.speak('Looking good'); this.lastT = now; this.lastCue = null;
    }
  },
};

// ---------------- start / stop ----------------
ui.startBtn.addEventListener('click', start);
ui.stopBtn.addEventListener('click', stop);
ui.flipBtn.addEventListener('click', () => { state.facing = state.facing === 'environment' ? 'user' : 'environment'; openCamera().catch(showError); });
ui.viewBtn.addEventListener('click', () => setView(state.view === 'side' ? 'rear' : 'side'));
ui.voiceBtn.addEventListener('click', () => setVoice(!state.voice));

async function start() {
  ui.startBtn.disabled = true;
  try {
    setView(ui.viewSelect.value);
    setVoice(ui.voiceCheck.checked);
    setStatus('Requesting motion access for auto-level…');
    const levelOk = await state.level.start();
    setStatus('Starting camera…');
    await openCamera();
    if (!state.pose) state.pose = await createPose(ASSETS, { onStatus: setStatus });
    ui.start.hidden = true; ui.app.hidden = false;
    state.running = true;
    if (state.voice) coach.speak('Gait coach ready.'); // also unlocks speech on iOS
    ui.hint.textContent = levelOk ? '' : 'Motion sensor unavailable: auto-level off, hold the phone level.';
    state.analyzer.reset(); resetFilters();
    scheduleFrame();
  } catch (err) {
    showError(err);
    ui.startBtn.disabled = false;
  }
}

function stop() {
  state.running = false;
  if (state.stream) { state.stream.getTracks().forEach((t) => t.stop()); state.stream = null; }
  state.level.stop(); state.level = new LevelSensor();
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  ui.app.hidden = true; ui.start.hidden = false; ui.startBtn.disabled = false;
  setStatus('');
}

async function openCamera() {
  if (state.stream) state.stream.getTracks().forEach((t) => t.stop());
  const constraints = {
    audio: false,
    video: { facingMode: state.facing, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 60 } },
  };
  state.stream = await navigator.mediaDevices.getUserMedia(constraints);
  ui.video.srcObject = state.stream;
  await ui.video.play();
  const mirror = state.facing === 'user';
  ui.video.classList.toggle('mirror', mirror); ui.canvas.classList.toggle('mirror', mirror);
  resetFilters(); state.analyzer.reset();
}

function setView(view) {
  state.view = view;
  state.analyzer.setView(view);
  ui.viewBtn.textContent = view === 'side' ? 'Side view' : 'Rear view';
  renderMetrics([]);
}

function setVoice(on) {
  state.voice = on;
  ui.voiceBtn.textContent = on ? '🔊 Voice' : '🔇 Voice';
  ui.voiceBtn.classList.toggle('off', !on);
}

function resetFilters() { state.drawSmoother.reset(); state.analysisSmoother.reset(); }

function setStatus(msg) { ui.status.textContent = msg; ui.status.classList.remove('error'); }
function showError(err) {
  console.error(err);
  const msg = err?.name === 'NotAllowedError' ? 'Camera access was denied. Allow camera access in Settings › Safari and reload.'
    : err?.name === 'NotFoundError' ? 'No camera found.'
    : `Could not start: ${err?.message ?? err}`;
  ui.status.textContent = msg; ui.status.classList.add('error');
}

// ---------------- frame loop ----------------
function scheduleFrame() {
  if (!state.running) return;
  if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) ui.video.requestVideoFrameCallback(onFrame);
  else requestAnimationFrame(onFrame);
}

function onFrame() {
  if (!state.running) return;
  const video = ui.video;
  if (video.readyState >= 2 && video.videoWidth) {
    if (ui.canvas.width !== video.videoWidth || ui.canvas.height !== video.videoHeight) {
      ui.canvas.width = video.videoWidth; ui.canvas.height = video.videoHeight;
    }
    const W = ui.canvas.width, H = ui.canvas.height;
    const now = performance.now();
    if (state.lastFrameT) state.fps += 0.1 * (1000 / (now - state.lastFrameT) - state.fps);
    state.lastFrameT = now;

    let det = { landmarks: null, world: null };
    try { det = state.pose.detect(video, now); } catch (err) { if (DEBUG) console.warn(err); }
    const raw = det.landmarks ? det.landmarks.map((p) => ({ x: p.x * W, y: p.y * H, v: p.visibility ?? 1 })) : null;
    const drawPts = state.drawSmoother.apply(raw, now);
    const measurePts = state.analysisSmoother.apply(raw, now);

    const roll = state.level.available ? state.level.roll : 0;
    // Auto-level: undo the camera roll so "vertical" in every angle means gravity, not the phone's edge.
    const levelled = measurePts ? rotatePoints(measurePts, W / 2, H / 2, rad(roll)) : null;
    state.analyzer.update(levelled, det.world, now);

    ctx.clearRect(0, 0, W, H);
    if (drawPts) drawSkeleton(ctx, drawPts, state.analyzer.tracking ? state.analyzer.live : null, { mirror: state.facing === 'user', view: state.view });
    if (state.level.available) drawHorizon(ctx, W, H, roll);

    if (now - state.lastLevelT > 100) { state.lastLevelT = now; renderLevel(); }
    if (now - state.lastUiT > 400) {
      state.lastUiT = now;
      const rows = evaluate(state.analyzer.getMetrics(), state.view);
      renderFeedback(rows); renderMetrics(rows);
      coach.tick(rows, now);
      ui.fps.textContent = `${state.fps.toFixed(0)} fps · ${state.pose.delegate}`;
    }
  }
  scheduleFrame();
}

// ---------------- HUD rendering ----------------
function renderLevel() {
  const lv = state.level;
  if (!lv.available) { ui.levelText.textContent = 'no level'; ui.levelBox.className = 'level na'; return; }
  const roll = lv.roll, pitch = lv.pitch;
  ui.bubble.style.transform = `translateX(${Math.max(-1, Math.min(1, roll / 15)) * 40}px)`;
  const ok = Math.abs(roll) < 2 && Math.abs(pitch) < 8;
  ui.levelBox.className = `level ${ok ? 'ok' : 'warn'}`;
  const pitchTxt = Math.abs(pitch) >= 8 ? ` · tilted ${pitch > 0 ? 'up' : 'down'} ${Math.abs(pitch).toFixed(0)}°` : '';
  ui.levelText.textContent = `${roll >= 0 ? '↻' : '↺'} ${Math.abs(roll).toFixed(1)}°${pitchTxt}`;
}

function renderFeedback(rows) {
  const measured = rows.filter((r) => r.status !== 'na');
  if (!measured.length) {
    return setHtml(ui.feedback, `<div class="card wait"><h3>${state.analyzer.tracking ? 'Analyzing strides…' : 'Looking for a runner'}</h3><p>${state.analyzer.tracking ? 'Keep running; feedback appears after a few steps.' : 'The whole body, head to feet, must be in frame.'}</p></div>`);
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
  setHtml(ui.feedback, html);
}

/** Rebuilding identical markup four times a second reflows the panel for nothing. */
function setHtml(el, html) {
  if (el.__html === html) return;
  el.__html = html;
  el.innerHTML = html;
}

function renderMetrics(rows) {
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  const html = standardsForView(state.view).map((s) => {
    const r = byId[s.id];
    const dot = !r || r.status === 'na' ? 'na' : r.status === 'ok' ? 'ok' : r.severity >= 1 ? 'bad' : 'warn';
    const lr = r && r.L != null && r.R != null ? `<span class="lr">L ${fmt(r, r.L)} · R ${fmt(r, r.R)}</span>` : '';
    return `<div class="metric"><span class="dot ${dot}"></span><span class="name">${s.label}</span><span class="val">${r ? fmt(r) : '–'}</span>${lr}<span class="tgt">${s.target[0]}–${s.target[1]}${s.unit === '°' ? '°' : ' ' + s.unit}</span></div>`;
  }).join('');
  setHtml(ui.metrics, html);
}

document.addEventListener('visibilitychange', () => { if (document.hidden && state.running) stop(); });
renderMetrics([]);

if (DEBUG) window.__gait = state; // ?debug exposes live state for inspection (Safari Web Inspector)
