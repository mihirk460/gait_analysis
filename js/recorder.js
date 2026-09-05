// Records the camera to a video Blob while a landmark track is captured alongside it.
//
// The video is held in memory only, and is thrown away when a new recording starts or the page
// closes; nothing is written to device storage. Bitrate and a hard duration cap keep the clip small
// (2 Mbps ~= 15 MB per minute at 720p).
import { LandmarkTrack } from './track.js';

const CANDIDATE_TYPES = [
  'video/mp4;codecs=avc1',   // Safari / iOS
  'video/mp4',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
];

export function pickMimeType() {
  if (typeof MediaRecorder === 'undefined') return null;
  return CANDIDATE_TYPES.find((t) => MediaRecorder.isTypeSupported?.(t)) ?? '';
}

export function formatBytes(n) {
  return n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.round(n / 1e3)} kB`;
}

export class SessionRecorder {
  /** onLimit fires when maxMs is reached, so the caller can stop and move to review. */
  constructor({ maxMs = 60000, bitrate = 2_000_000, onLimit = () => {} } = {}) {
    this.maxMs = maxMs; this.bitrate = bitrate; this.onLimit = onLimit;
    this.track = new LandmarkTrack();
    this.chunks = []; this.rec = null; this.t0 = 0; this.stopped = false;
    this.url = null; this.blob = null;
  }

  get recording() { return !!this.rec && this.rec.state === 'recording'; }
  get elapsedMs() { return this.t0 ? Math.min(performance.now() - this.t0, this.maxMs) : 0; }

  start(stream) {
    const mimeType = pickMimeType();
    this.mime = mimeType;
    // An unsupported mimeType throws, so only pass one we probed successfully.
    const opts = { videoBitsPerSecond: this.bitrate, ...(mimeType ? { mimeType } : {}) };
    this.rec = new MediaRecorder(stream, opts);
    this.rec.ondataavailable = (e) => { if (e.data && e.data.size) this.chunks.push(e.data); };
    this.rec.start(1000); // one chunk per second, so a long clip is not one huge buffer
    this.t0 = performance.now();
    this.stopped = false;
  }

  /** Call once per analysed camera frame. Returns false once the duration cap is hit. */
  addFrame(landmarks, roll) {
    if (!this.recording) return false;
    const t = performance.now() - this.t0;
    if (t >= this.maxMs) { this.onLimit(); return false; }
    this.track.push(t, landmarks, roll);
    return true;
  }

  /** Resolves once the encoder has flushed. Returns { blob, url, mime, wallMs, track }. */
  stop() {
    return new Promise((resolve) => {
      if (!this.rec || this.rec.state === 'inactive') return resolve(this._result());
      const wallMs = performance.now() - this.t0;
      this.rec.onstop = () => {
        this.blob = new Blob(this.chunks, { type: this.mime || this.chunks[0]?.type || 'video/mp4' });
        this.url = URL.createObjectURL(this.blob);
        this.wallMs = wallMs;
        resolve(this._result());
      };
      this.rec.stop();
    });
  }

  _result() {
    return { blob: this.blob, url: this.url, mime: this.mime, wallMs: this.wallMs ?? this.track.duration, track: this.track };
  }

  /** Release the video blob. The page holds only one recording at a time. */
  dispose() {
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = null; this.blob = null; this.chunks = [];
  }
}
