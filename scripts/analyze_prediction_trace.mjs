#!/usr/bin/env node
import fs from 'node:fs';

const file = process.argv[2];
if (!file) {
  console.error('Usage: node scripts/analyze_prediction_trace.mjs <trace.json>');
  process.exit(1);
}

const trace = JSON.parse(fs.readFileSync(file, 'utf8'));
const events = Array.isArray(trace.events) ? trace.events : [];
const data = (event) => event?.data ?? {};
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const values = (type, key) => events
  .filter((event) => event.type === type)
  .map((event) => data(event)[key])
  .filter(finite);

function pct(sorted, p) {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1))];
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

function stats(list) {
  if (list.length === 0) return { count: 0, avg: 0, p50: 0, p95: 0, p99: 0, max: 0 };
  const sorted = [...list].sort((a, b) => a - b);
  const total = list.reduce((sum, value) => sum + value, 0);
  return {
    count: list.length,
    avg: round(total / list.length),
    p50: round(pct(sorted, 0.5)),
    p95: round(pct(sorted, 0.95)),
    p99: round(pct(sorted, 0.99)),
    max: round(sorted[sorted.length - 1]),
  };
}

function gaps(type) {
  const matching = events.filter((event) => event.type === type);
  const out = [];
  for (let i = 1; i < matching.length; i++) out.push(matching[i].at - matching[i - 1].at);
  return out;
}

function nearestBefore(type, at) {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event.at <= at && event.type === type) return event;
  }
  return null;
}

function activeMovement(event) {
  const d = data(event);
  return !!(d.moveForward || d.moveBack || d.strafeLeft || d.strafeRight);
}

function movingStepBuckets(list) {
  const buckets = { zero: 0, lt005: 0, lt015: 0, lt025: 0, tickish025To05: 0, gt05: 0 };
  for (const event of list) {
    const step = data(event).displayStep;
    if (!finite(step)) continue;
    if (step < 0.001) buckets.zero++;
    else if (step < 0.05) buckets.lt005++;
    else if (step < 0.15) buckets.lt015++;
    else if (step < 0.25) buckets.lt025++;
    else if (step < 0.5) buckets.tickish025To05++;
    else buckets.gt05++;
  }
  return buckets;
}

function correctionByAnchor() {
  const groups = new Map();
  for (const event of events) {
    if (event.type !== 'snapshot-reconcile') continue;
    const anchor = String(data(event).anchorMode ?? 'unknown');
    const value = data(event).renderCorrectionDist;
    if (!finite(value)) continue;
    const list = groups.get(anchor) ?? [];
    list.push(value);
    groups.set(anchor, list);
  }
  return Object.fromEntries([...groups.entries()].map(([anchor, list]) => [anchor, stats(list)]));
}

function predictionsBetween(afterAt, beforeOrAt) {
  return events.filter((event) => event.type === 'input-predict' && event.at > afterAt && event.at <= beforeOrAt);
}

const frames = events.filter((event) => event.type === 'frame');
const frameDt = values('frame', 'frameDtMs').filter((value) => value >= 0);
const displayStep = values('frame', 'displayStep');
const jumps = frames.filter((event) => finite(data(event).displayStep) && data(event).displayStep > 0.75);
const jumpsOnNormalFrames = jumps.filter((event) => !finite(data(event).frameDtMs) || data(event).frameDtMs <= 50);
const movingFrames = frames.filter(activeMovement);
const largestDisplaySteps = [...frames]
  .filter((event) => finite(data(event).displayStep))
  .sort((a, b) => data(b).displayStep - data(a).displayStep)
  .slice(0, 10)
  .map((event) => {
    const previousFrame = frames[frames.indexOf(event) - 1] ?? null;
    const preds = predictionsBetween(previousFrame?.at ?? -Infinity, event.at);
    const rec = nearestBefore('snapshot-reconcile', event.at);
    return {
      at: round(event.at),
      frameDtMs: data(event).frameDtMs,
      displayStep: data(event).displayStep,
      camYawStep: data(event).camYawStep,
      input: {
        f: data(event).moveForward ?? 0,
        b: data(event).moveBack ?? 0,
        sl: data(event).strafeLeft ?? 0,
        sr: data(event).strafeRight ?? 0,
      },
      predictionsSincePreviousFrame: preds.length,
      predictedDistSincePreviousFrame: round(preds.reduce((sum, pred) => sum + (finite(data(pred).predictedDist) ? data(pred).predictedDist : 0), 0)),
      msSinceReconcile: rec ? round(event.at - rec.at) : null,
      lastCorrection: rec && finite(data(rec).renderCorrectionDist) ? data(rec).renderCorrectionDist : null,
      mainRendererP95: data(event).mainRendererP95,
      mainHudP95: data(event).mainHudP95,
      rphTotalP95: data(event).rphTotalP95,
      longTaskCount: data(event).longTaskCount,
      longTaskMax: data(event).longTaskMax,
    };
  });

let jumpsAfterPrediction = 0;
let jumpsAfterReconcile = 0;
for (const jump of jumps) {
  const pred = nearestBefore('input-predict', jump.at);
  const rec = nearestBefore('snapshot-reconcile', jump.at);
  if (pred && jump.at - pred.at <= 50) jumpsAfterPrediction++;
  if (rec && jump.at - rec.at <= 50) jumpsAfterReconcile++;
}

const firstAt = events[0]?.at ?? 0;
const lastAt = events.at(-1)?.at ?? firstAt;
const seconds = Math.max(0, (lastAt - firstAt) / 1000);
const count = (type) => events.filter((event) => event.type === type).length;

const report = {
  file,
  url: trace.url ?? null,
  seconds: round(seconds),
  frameRate: seconds > 0 ? round(frames.length / seconds) : 0,
  frameDt: stats(frameDt),
  longFrames: {
    gt33: frameDt.filter((value) => value > 33).length,
    gt50: frameDt.filter((value) => value > 50).length,
    gt100: frameDt.filter((value) => value > 100).length,
  },
  displayStep: stats(displayStep),
  displayStepBuckets: {
    gt05: displayStep.filter((value) => value > 0.5).length,
    gt075: displayStep.filter((value) => value > 0.75).length,
    gt1: displayStep.filter((value) => value > 1).length,
  },
  movingFrames: {
    count: movingFrames.length,
    displayStep: stats(movingFrames.map((event) => data(event).displayStep).filter(finite)),
    buckets: movingStepBuckets(movingFrames),
  },
  jumps: {
    gt075: jumps.length,
    gt075OnFramesAtOrBelow50ms: jumpsOnNormalFrames.length,
    within50msAfterPrediction: jumpsAfterPrediction,
    within50msAfterReconcile: jumpsAfterReconcile,
  },
  prediction: {
    count: count('input-predict'),
    predictedDist: stats(values('input-predict', 'predictedDist')),
  },
  snapshots: {
    queued: count('snapshot-queued'),
    reconciled: count('snapshot-reconcile'),
    queuedGapMs: stats(gaps('snapshot-queued')),
    reconcileGapMs: stats(gaps('snapshot-reconcile')),
    renderCorrectionDist: stats(values('snapshot-reconcile', 'renderCorrectionDist')),
    ackLag: stats(values('snapshot-reconcile', 'ackLag')),
    pendingAfter: stats(values('snapshot-reconcile', 'pendingAfter')),
    correctionByAnchor: correctionByAnchor(),
  },
  longFrameContext: {
    mainRendererP95: stats(values('frame', 'mainRendererP95')),
    mainHudP95: stats(values('frame', 'mainHudP95')),
    rphTotalP95: stats(values('frame', 'rphTotalP95')),
    rphEntitiesP95: stats(values('frame', 'rphEntitiesP95')),
    rphWorldP95: stats(values('frame', 'rphWorldP95')),
    rphNameplatesP95: stats(values('frame', 'rphNameplatesP95')),
    rphSubmitP95: stats(values('frame', 'rphSubmitP95')),
    longTaskMax: stats(values('frame', 'longTaskMax')),
  },
  largestDisplaySteps,
};

console.log(JSON.stringify(report, null, 2));
