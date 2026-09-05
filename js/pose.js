// Thin wrapper around MediaPipe Pose Landmarker (33 body landmarks, on-device).
export async function createPose(assets, { delegate = 'GPU', onStatus = () => {} } = {}) {
  onStatus('Loading pose engine…');
  const mod = await import(assets.bundle);
  const vision = await mod.FilesetResolver.forVisionTasks(assets.wasm);
  const make = (d) =>
    mod.PoseLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: assets.model, delegate: d },
      runningMode: 'VIDEO',
      numPoses: 1,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
      outputSegmentationMasks: false,
    });
  onStatus('Loading pose model…');
  let landmarker, used = delegate;
  try {
    landmarker = await make(delegate);
  } catch (err) {
    console.warn(`${delegate} delegate failed, falling back to CPU`, err);
    used = 'CPU';
    landmarker = await make('CPU');
  }
  return {
    delegate: used,
    /** Returns { landmarks: [{x,y,z,visibility}]*33 | null, world: [...] | null } */
    detect(video, timestampMs) {
      const res = landmarker.detectForVideo(video, timestampMs);
      return { landmarks: res.landmarks?.[0] ?? null, world: res.worldLandmarks?.[0] ?? null };
    },
    close() { landmarker.close(); },
  };
}
