# Gait Coach

Real-time treadmill running form analysis that runs in Safari on an iPhone. It uses the camera and on-device
pose estimation (MediaPipe Pose Landmarker, 33 body landmarks) to draw joint markers and body segments
(foot, shin, thigh, trunk, upper arm, forearm), detects each foot contact and toe-off, measures the joint
angles that running-analysis clinicians use, compares them with published reference ranges, and tells you
on screen and by voice what to change. No video leaves the phone.

## Run it on your iPhone

The camera API requires HTTPS, so the app has to be served from an HTTPS host. GitHub Pages is the zero-cost option:

1. Merge this branch into `main`. The `Deploy to GitHub Pages` workflow runs on every push to `main`
   (or run it manually from the Actions tab) and enables Pages itself on the first run.
2. If that first run fails with `Get Pages site failed ... Not Found`, the repository's Pages site could not be
   created automatically: open **Settings › Pages**, set **Source** to **GitHub Actions**, and re-run the job.
   Pages is free on public repositories; on a private one it needs a paid plan.
3. Open `https://<your-user>.github.io/gait_analysis/` in Safari on the iPhone.
4. Tap Share, then **Add to Home Screen**. It then launches full-screen like a native app.

Requirements: iOS 16.4 or newer (WebAssembly SIMD, WebGL 2). The pose engine and model load from the MediaPipe CDN
on first use (about 17 MB), so open it once on Wi-Fi.

## Using it on the treadmill

- Prop the phone about 3 m from the treadmill at hip height, in portrait.
  - **Side view** measures stride mechanics: cadence, contact time, knee, shin, foot and hip angles at contact
    and toe-off, trunk lean, vertical bounce, elbow angle.
  - **Rear view** (phone directly behind the belt) measures pelvic drop, knee collapse inward and trunk sway.
- Tap **Start**. iOS asks for motion access (auto-level) and camera access.
- The bubble and horizon line turn green when the phone is level. Small tilts are corrected mathematically; a
  pitched camera (pointing up or down more than 8°) distorts angles and is flagged.
- Keep the whole body, head to feet, in frame. After a few strides the worst issues appear as cards with the
  measured value, the target range and what to do; the top cue is spoken every few seconds. **All metrics**
  expands a table with left/right values.

## What it measures and against what

| Metric | Reference range | Basis |
| --- | --- | --- |
| Cadence | 170–190 steps/min | Heiderscheit et al. 2011: raising step rate 5–10 % lowers joint loading |
| Ground contact time | 150–300 ms | Recreational runners typically 250–300 ms; shorter with better mechanics |
| Knee flexion at initial contact | 10–25° | Souza 2016: about 20°; an extended knee indicates a stiff, braking landing |
| Shin angle at initial contact | −3° to 10° (ankle ahead of knee) | Souza 2016: tibia > 10° forward of vertical indicates overstriding |
| Foot angle at initial contact | −10° to 15° (toes up positive) | Lieberman 2010 / Souza 2016; strongly dorsiflexed heel strike plus forward shin = braking |
| Peak knee flexion in stance | 35–50° | Souza 2016: about 45°; less is a stiff leg, more is collapse |
| Hip extension at toe-off (thigh vs trunk) | 10–25° | Souza 2016, Novacheck 1998 |
| Trunk forward lean | 5–12° | Souza 2016: 7–10° from the ankles |
| Vertical oscillation | 5–11 cm | Population running-dynamics data; more is energy going up, not forward |
| Elbow angle | 70–110° | Coaching consensus of about 90° |
| Contralateral pelvic drop (rear) | < 5° | Bramah et al. 2018: each extra degree raised injury odds about 80 % |
| Knee frontal-plane projection angle (rear) | < 10° | Willson & Davis 2008 |
| Trunk lateral sway (rear) | < 5° | Bramah et al. 2018 |

These describe healthy recreational running, not elite targets. The app is a coaching aid, not a medical device.

## How it works

- **Pose**: `js/pose.js` wraps MediaPipe Pose Landmarker (GPU delegate, CPU fallback) in video mode.
- **Auto-level**: `js/level.js` reads the gravity vector from `devicemotion`, computes camera roll and pitch, and the
  app rotates every landmark by the roll about the frame centre before any angle is computed. Angles measured
  against vertical (trunk lean, shin angle, hip extension) therefore refer to gravity, not to the phone's edge.
  Joint-to-joint angles are rotation-invariant anyway. The horizon line on screen shows the corrected horizontal.
- **Stride events** (`js/gait.js`): the belt level is estimated as the lowest point the foot reaches over the last
  2.5 s. Initial contact is when the sole is within 6 % of leg length of the belt, has stopped descending, and is
  no longer moving forward relative to the hips (on a treadmill the belt drags the stance foot backwards).
  Toe-off is when the sole rises off the belt. Because events fall between two frames, the angles are averaged
  over the frame before and after. Metrics are medians over the last six strides, per side, so a single bad step
  does not trigger a cue and left/right asymmetries are visible.
- **Scale** for vertical bounce comes from MediaPipe's metric world landmarks (leg length in metres divided by leg
  length in pixels), with a fallback of 0.86 m hip-to-ankle.
- **Feedback** (`js/standards.js`): each metric has a target range, a tolerance that sets severity, and a
  spoken cue plus a longer explanation. The worst three issues are shown; the top one is spoken (Web Speech API).

## Accuracy and limitations

- Single-camera 2D estimates. Expect a few degrees of error on joint angles and roughly ±40 ms on contact time at
  30 fps. Angles taken at a single instant (contact, toe-off) are the least certain because the joint moves
  several degrees per frame there.
- The pose model runs at roughly 20–30 fps on a recent iPhone; lower frame rates widen the timing error.
- The camera must be side-on (or directly behind) and level. Perspective from an angled camera biases every
  angle, which is why pitch is flagged and roll is corrected.
- Rear-view stance detection uses ankle height and is coarser than the side view.
- Landscape orientation is supported in code but the level compensation has only been verified in portrait.
- Built and tested here in headless Chromium with the real pose engine and a real photo, plus unit tests on a
  synthetic runner. It has not yet been run on a physical iPhone, so the first real session may surface Safari
  or sensor quirks. Open with `?debug` to get a `window.__gait` handle in Safari Web Inspector.

## Development

No build step. Static files, ES modules.

```
index.html          app shell
css/style.css
js/app.js           camera, frame loop, HUD, voice cues
js/pose.js          MediaPipe wrapper
js/level.js         gravity-based roll/pitch
js/gait.js          smoothing, stride events, metrics
js/standards.js     reference ranges and coaching text
js/draw.js          skeleton, angle labels, horizon line
js/geometry.js      angle maths
tests/              node:test suites; tests/synth.js is a kinematic treadmill runner
```

```
npm test                       # unit tests on synthetic strides, geometry, level maths
python3 -m http.server 8080    # local preview (camera only works on localhost or HTTPS)
```

## References

- Souza RB. An Evidence-Based Videotaped Running Biomechanics Analysis. Phys Med Rehabil Clin N Am. 2016.
- Heiderscheit BC et al. Effects of step rate manipulation on joint mechanics during running. Med Sci Sports Exerc. 2011.
- Bramah C et al. Is There a Pathological Gait Associated With Common Soft Tissue Running Injuries? Am J Sports Med. 2018.
- Willson JD, Davis IS. Utility of the frontal plane projection angle in females with patellofemoral pain. J Orthop Sports Phys Ther. 2008.
- Lieberman DE et al. Foot strike patterns and collision forces in habitually barefoot versus shod runners. Nature. 2010.
- Novacheck TF. The biomechanics of running. Gait Posture. 1998.

## License

Apache-2.0, see `LICENSE`.
