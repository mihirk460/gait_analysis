// Reference ranges for treadmill running form, and the coaching feedback tied to each.
// Ranges are drawn from 2D video running-analysis literature (see README for sources):
//   Souza 2016 (videotaped running analysis), Heiderscheit 2011 (step rate),
//   Bramah 2018 (pelvic drop, injury), Willson & Davis 2008 (frontal plane projection angle),
//   Novacheck 1998, Lieberman 2010 (foot strike).
// They describe healthy recreational running, not elite targets, and are not a medical diagnosis.

export const STANDARDS = [
  {
    id: 'cadence', label: 'Cadence', unit: 'spm', view: 'both', target: [170, 190], tol: 10, digits: 0,
    low: { cue: 'Quicker steps', text: 'Cadence is low. Shorten the stride and take quicker steps (aim for a 5–10% increase). Low cadence usually means overstriding and higher impact.' },
    high: { cue: 'Relax the stride', text: 'Cadence is very high for the pace. Only a problem if it feels forced; let the stride open slightly.' },
  },
  {
    id: 'gct', label: 'Ground contact time', unit: 'ms', view: 'side', target: [150, 300], tol: 50, digits: 0,
    low: null,
    high: { cue: 'Quick off the ground', text: 'Feet stay on the belt too long. Think "quick off the ground". Usually improves with higher cadence and a slight forward lean.' },
  },
  {
    id: 'kneeIC', label: 'Knee bend at landing', unit: '°', view: 'side', target: [10, 25], tol: 8, digits: 0,
    low: { cue: 'Soften the landing', text: 'Knee is nearly straight at landing: a stiff, braking footfall. Land with a softer, slightly bent knee under your hips.' },
    high: { cue: 'Lighter footfall', text: 'Knee is heavily bent at landing. Usually harmless; if vertical bounce is also high, aim for a lighter footfall.' },
  },
  {
    id: 'tibiaIC', label: 'Shin angle at landing', unit: '°', view: 'side', target: [-3, 10], tol: 5, digits: 0,
    low: { cue: 'Check camera angle', text: 'Foot lands behind the knee, which is unusual. Check that the camera is side-on and level.' },
    high: { cue: 'Land under your hips', text: 'Overstriding: the foot lands well ahead of the knee. Shorten the stride so the shin is close to vertical at contact. Raising cadence is the quickest fix.' },
  },
  {
    id: 'footIC', label: 'Foot angle at landing', unit: '°', view: 'side', target: [-10, 15], tol: 10, digits: 0,
    low: { cue: 'Flatter foot', text: 'Strong forefoot landing (toes down). Fine for many runners; watch calf and Achilles load if this is new.' },
    high: { cue: 'Flatter foot', text: 'Pronounced heel-first landing with toes pulled up. Combined with a forward shin angle this is braking. Let the foot land flatter and closer under you.' },
  },
  {
    id: 'kneePeak', label: 'Peak knee bend in stance', unit: '°', view: 'side', target: [35, 50], tol: 8, digits: 0,
    low: { cue: 'Let the knee absorb', text: 'Knee barely bends in mid-stance: a stiff leg that raises loading rates. Let the knee soften and absorb.' },
    high: { cue: 'Stay tall over the leg', text: 'Knee collapses deep in mid-stance. Suggests weak hip/quad control or overstriding. Shorten the stride; build single-leg strength.' },
  },
  {
    id: 'hipExtTO', label: 'Hip extension at toe-off', unit: '°', view: 'side', target: [10, 25], tol: 6, digits: 0,
    low: { cue: 'Drive the hip back', text: 'Hip does not extend behind you at toe-off, so you pull the leg forward instead of pushing back. Cue: push the ground away behind you. Check hip-flexor tightness.' },
    high: { cue: 'Ease the back kick', text: 'Very large hip extension at toe-off. May indicate an over-arched lower back or exaggerated back-side mechanics.' },
  },
  {
    id: 'trunkLean', label: 'Trunk forward lean', unit: '°', view: 'side', target: [5, 12], tol: 5, digits: 0,
    low: { cue: 'Lean from the ankles', text: 'Trunk is upright or leaning back. Lean slightly forward from the ankles, not the waist (about 5–10°).' },
    high: { cue: 'Stand tall', text: 'Excessive forward lean, probably bending at the waist. Stand tall and lean from the ankles.' },
  },
  {
    id: 'vertOsc', label: 'Vertical bounce', unit: 'cm', view: 'side', target: [5, 11], tol: 3, digits: 1,
    low: null,
    high: { cue: 'Less bounce', text: 'Too much vertical bounce; energy goes up instead of forward. Raise cadence, lower the stride, think "run over the ground".' },
  },
  {
    id: 'elbow', label: 'Elbow angle', unit: '°', view: 'side', target: [70, 110], tol: 15, digits: 0,
    low: { cue: 'Relax the arms', text: 'Arms are tightly flexed. Relax to about 90° at the elbow and drop the shoulders.' },
    high: { cue: 'Bend the elbows', text: 'Arms are too straight. Bend the elbows to about 90°, swing from the shoulder, hands loose.' },
  },
  {
    id: 'pelvicDrop', label: 'Pelvic drop', unit: '°', view: 'rear', target: [-5, 5], tol: 3, digits: 0,
    low: null,
    high: { cue: 'Level the hips', text: 'The free-side hip drops during stance (contralateral pelvic drop). Linked to weak hip abductors and higher injury odds. Strengthen glute med (side planks, single-leg work); cue "level hips".' },
  },
  {
    id: 'kneeValgus', label: 'Knee collapse inward', unit: '°', view: 'rear', target: [-10, 10], tol: 5, digits: 0,
    low: null,
    high: { cue: 'Knee over the toes', text: 'Knee collapses inward during stance (dynamic valgus). Strengthen the hips; cue the knee tracking over the second toe.' },
  },
  {
    id: 'trunkLateral', label: 'Trunk side sway', unit: '°', view: 'rear', target: [0, 5], tol: 3, digits: 0,
    low: null,
    high: { cue: 'Quiet upper body', text: 'Trunk sways side to side. Often compensates for a weak stance hip; cue a tall, quiet upper body.' },
  },
];

export const STANDARD_BY_ID = Object.fromEntries(STANDARDS.map((s) => [s.id, s]));

export function standardsForView(view) {
  return STANDARDS.filter((s) => s.view === 'both' || s.view === view);
}

/**
 * Compare measured metrics with the reference ranges.
 * metrics: { id: { value, L, R, n } } from GaitAnalyzer.getMetrics().
 * Returns rows sorted by severity (worst first). status: 'ok' | 'low' | 'high' | 'na'.
 */
export function evaluate(metrics, view) {
  const rows = standardsForView(view).map((s) => {
    const m = metrics[s.id];
    if (!m) return { ...s, status: 'na', severity: 0, value: null, L: null, R: null, message: null, cue: null };
    const [lo, hi] = s.target;
    let status = 'ok', severity = 0;
    if (m.value < lo) { status = 'low'; severity = (lo - m.value) / s.tol; }
    else if (m.value > hi) { status = 'high'; severity = (m.value - hi) / s.tol; }
    const fb = status === 'low' ? s.low : status === 'high' ? s.high : null;
    if (status !== 'ok' && !fb) { status = 'ok'; severity = 0; } // out of range but not something we coach
    return { ...s, status, severity, value: m.value, L: m.L, R: m.R, n: m.n, message: fb?.text ?? null, cue: fb?.cue ?? null };
  });
  return rows.sort((a, b) => b.severity - a.severity);
}

/** Left/right asymmetry note for a metric row, or null. */
export function asymmetry(row) {
  if (row.L == null || row.R == null) return null;
  const diff = Math.abs(row.L - row.R);
  const scale = Math.max(Math.abs(row.target[1] - row.target[0]), 1);
  if (diff < 0.5 * scale) return null;
  const weaker = row.L > row.R ? 'left' : 'right';
  return `Left/right differ by ${diff.toFixed(row.digits)}${row.unit} (${weaker} higher).`;
}

export function fmt(row, v = row.value) {
  if (v == null || !Number.isFinite(v)) return '–';
  return `${v.toFixed(row.digits)}${row.unit === '°' ? '°' : ' ' + row.unit}`;
}
