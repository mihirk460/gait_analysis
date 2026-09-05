// Where the pose model and its runtime are loaded from. Everything runs on-device;
// nothing from the camera leaves the phone. `?assets=<base>` overrides the location
// (used by the smoke test to serve a local copy).
const params = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
const local = params.get('assets');

const CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1';

export const ASSETS = local
  ? { bundle: `${local}/vision_bundle.mjs`, wasm: `${local}/wasm`, model: `${local}/pose_landmarker_lite.task` }
  : {
      bundle: `${CDN}/vision_bundle.mjs`,
      wasm: `${CDN}/wasm`,
      model: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
    };

export const DEBUG = params.has('debug');
