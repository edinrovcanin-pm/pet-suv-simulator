// SUV uptake-time simulation model.
//
// Two physically distinct effects are modeled separately (this separation is the
// correct architecture, per the FDG PET literature):
//
//  1. BIOLOGY drives how decay-corrected SUV changes with uptake time.
//     Power-law form:  SUV(t) = SUV60 * (t/60)^a
//     with a tissue-specific retention exponent `a`:
//        tumor +0.25, inflammation +0.28, muscle ~0, liver -0.10, blood pool -0.15
//     (=> tumor SUV ~+19% at 120 min, blood pool ~-10% — matches dual-time-point data.)
//
//  2. DECAY drives image noise. F-18 decays (T½ = 109.77 min), so for a FIXED scan
//     duration, fewer counts are collected at later uptake:
//        relativeCounts(t) = exp(-lambda*(t-60)),  noise(t) ∝ 1/sqrt(counts) = exp(+lambda*(t-60)/2)
//
//  Detectability:  CNR(t) = (SUV_lesion(t) - SUV_bg(t)) / noise(t)
//  rises (contrast up) then falls (noise up) -> an optimal uptake time exists.

import type { PetSlice, RoiCircle, TimePoint } from "./types";

export const F18_HALFLIFE_MIN = 109.77;
export const LAMBDA_PER_MIN = Math.LN2 / F18_HALFLIFE_MIN; // 0.0063142

export type TissueClass =
  | "tumor"
  | "inflammation"
  | "muscle"
  | "liver"
  | "blood";

export const TISSUE_EXPONENT: Record<TissueClass, number> = {
  tumor: 0.25,
  inflammation: 0.28,
  muscle: 0.0,
  liver: -0.1,
  blood: -0.15,
};

export const TISSUE_LABEL: Record<TissueClass, string> = {
  tumor: "Tumor (malignitet)",
  inflammation: "Upala",
  muscle: "Mišić",
  liver: "Jetra",
  blood: "Krvni pool (medijastinum)",
};

// Whole-image heuristic: map a voxel's 60-min SUV to a retention exponent.
// Low/background SUV washes out; high SUV (lesion-like) accumulates.
const A_BG = -0.15;
const A_TUMOR = 0.25;
const S_MID = 3.5;
const S_W = 1.1;

export function retentionExponentForSuv(suv60: number): number {
  const sig = 1 / (1 + Math.exp(-(suv60 - S_MID) / S_W));
  return A_BG + (A_TUMOR - A_BG) * sig;
}

/**
 * Decay-corrected SUV at uptake time `minutes`, projected from the value measured
 * at `refMinutes` (the study's actual uptake time). SUV(t) = SUV_ref*(t/ref)^a.
 */
export function suvAtTime(
  suvRef: number,
  minutes: number,
  exponent: number,
  refMinutes = 60
): number {
  if (suvRef <= 0) return 0;
  return suvRef * Math.pow(minutes / refMinutes, exponent);
}

/** Relative true+scatter counts vs the reference scan (fixed scan duration). */
export function relativeCounts(minutes: number, refMinutes = 60): number {
  return Math.exp(-LAMBDA_PER_MIN * (minutes - refMinutes));
}

/** Relative statistical noise vs reference. countMatched=true holds noise constant. */
export function relativeNoise(
  minutes: number,
  countMatched: boolean,
  refMinutes = 60
): number {
  if (countMatched) return 1;
  return 1 / Math.sqrt(relativeCounts(minutes, refMinutes));
}

/**
 * Simulate a whole slice's SUV map at a new uptake time using the per-voxel
 * heuristic exponent, projected from the measured reference time. Returns a new
 * Float32Array (does not mutate input).
 */
export function simulateSlice(
  slice: PetSlice,
  minutes: number,
  refMinutes = 60
): Float32Array {
  const src = slice.suv;
  const out = new Float32Array(src.length);
  const ratioCache = new Map<number, number>();
  for (let i = 0; i < src.length; i++) {
    const s = src[i];
    if (s <= 0) {
      out[i] = 0;
      continue;
    }
    // Quantize SUV to reuse pow() results (perf on 128x128+).
    const key = Math.round(s * 20);
    let ratio = ratioCache.get(key);
    if (ratio === undefined) {
      const a = retentionExponentForSuv(s);
      ratio = Math.pow(minutes / refMinutes, a);
      ratioCache.set(key, ratio);
    }
    out[i] = s * ratio;
  }
  return out;
}

export interface RoiStats {
  mean: number;
  max: number;
  std: number;
  cov: number; // coefficient of variation = std/mean
  count: number;
}

/** Statistics over a circular ROI on a slice (60-min values). */
export function roiStats(slice: PetSlice, roi: RoiCircle): RoiStats {
  const { rows, cols, suv } = slice;
  const r2 = roi.r * roi.r;
  let sum = 0;
  let sumSq = 0;
  let max = 0;
  let n = 0;
  const x0 = Math.max(0, Math.floor(roi.cx - roi.r));
  const x1 = Math.min(cols - 1, Math.ceil(roi.cx + roi.r));
  const y0 = Math.max(0, Math.floor(roi.cy - roi.r));
  const y1 = Math.min(rows - 1, Math.ceil(roi.cy + roi.r));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - roi.cx;
      const dy = y - roi.cy;
      if (dx * dx + dy * dy > r2) continue;
      const v = suv[y * cols + x];
      sum += v;
      sumSq += v * v;
      if (v > max) max = v;
      n++;
    }
  }
  const mean = n > 0 ? sum / n : 0;
  const variance = n > 0 ? Math.max(0, sumSq / n - mean * mean) : 0;
  const std = Math.sqrt(variance);
  return { mean, max, std, cov: mean > 0 ? std / mean : 0, count: n };
}

export interface CurveOptions {
  /** ROI stats measured on the study, at its actual uptake time (refMinutes). */
  lesionSuvRefMax: number;
  lesionSuvRefMean: number;
  bgSuvRefMean: number;
  /** Measured background coefficient of variation (spatial noise) at ref time. */
  bgCovRef: number;
  lesionClass: TissueClass;
  bgClass: TissueClass;
  /** Uptake times to evaluate (minutes). */
  times: number[];
  /** Study's measured uptake time (min) that ROI values correspond to. */
  refMinutes: number;
  /** If true, assume scan duration adjusted to keep counts constant. */
  countMatched: boolean;
}

export function buildTimeCurve(opts: CurveOptions): TimePoint[] {
  const aLesion = TISSUE_EXPONENT[opts.lesionClass];
  const aBg = TISSUE_EXPONENT[opts.bgClass];
  const ref = opts.refMinutes;
  // Absolute background noise in SUV units at ref time (spatial CoV from the data).
  const sigmaRef = Math.max(opts.bgCovRef, 0.05) * opts.bgSuvRefMean;

  return opts.times.map((t) => {
    const lesionSuvMax = suvAtTime(opts.lesionSuvRefMax, t, aLesion, ref);
    const lesionSuvMean = suvAtTime(opts.lesionSuvRefMean, t, aLesion, ref);
    const backgroundSuvMean = suvAtTime(opts.bgSuvRefMean, t, aBg, ref);
    const noise = relativeNoise(t, opts.countMatched, ref);
    const sigma = sigmaRef * noise;
    const contrast = Math.max(0, lesionSuvMax - backgroundSuvMean);
    const cnr = sigma > 0 ? contrast / sigma : 0;
    return {
      minutes: t,
      lesionSuvMax,
      lesionSuvMean,
      backgroundSuvMean,
      tbr: backgroundSuvMean > 0 ? lesionSuvMax / backgroundSuvMean : 0,
      relativeNoise: noise,
      cnr,
      relativeCounts: relativeCounts(t, ref),
    };
  });
}

export interface OptimalResult {
  optimalMinutes: number;
  optimalCnr: number;
  cnrAtRef: number;
  gainVsRefPct: number;
}

/** Optimal = uptake time maximizing CNR. Reference = the study's actual uptake. */
export function findOptimal(points: TimePoint[], refMinutes: number): OptimalResult {
  let best = points[0];
  for (const p of points) if (p.cnr > best.cnr) best = p;
  const atRef =
    points.reduce((a, b) =>
      Math.abs(b.minutes - refMinutes) < Math.abs(a.minutes - refMinutes) ? b : a
    ).cnr || 1;
  return {
    optimalMinutes: best.minutes,
    optimalCnr: best.cnr,
    cnrAtRef: atRef,
    gainVsRefPct: atRef > 0 ? (100 * (best.cnr - atRef)) / atRef : 0,
  };
}

/** Default set of uptake times to simulate (min). */
export const DEFAULT_TIMES = [30, 40, 50, 60, 75, 90, 105, 120, 150, 180];
