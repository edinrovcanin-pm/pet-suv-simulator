// Synthetic whole-body FDG PET phantom, so the app is fully usable without
// real patient DICOM (demo mode) and so the pipeline can be verified.
// SUV values are chosen to match typical 60-min FDG biodistribution.

import type { PetSlice, PetStudy } from "./types";

// Deterministic RNG (mulberry32) for reproducible phantoms.
function rng(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Blob {
  x: number; // fractional center 0-1
  y: number;
  rx: number; // fractional radius
  ry: number;
  suv: number; // peak SUV at 60 min
  slices: [number, number]; // inclusive slice range where present
}

const N = 128;
const NUM_SLICES = 15;

// Typical 60-min biodistribution (SUVbw).
const ANATOMY: Blob[] = [
  { x: 0.5, y: 0.55, rx: 0.34, ry: 0.42, suv: 0.55, slices: [0, 14] }, // soft-tissue body
  { x: 0.38, y: 0.5, rx: 0.16, ry: 0.14, suv: 2.1, slices: [4, 10] }, // liver
  { x: 0.5, y: 0.42, rx: 0.06, ry: 0.06, suv: 1.8, slices: [3, 8] }, // blood pool / mediastinum
  { x: 0.62, y: 0.62, rx: 0.05, ry: 0.09, suv: 0.85, slices: [6, 14] }, // muscle (psoas)
  { x: 0.35, y: 0.63, rx: 0.05, ry: 0.09, suv: 0.85, slices: [6, 14] }, // muscle
  { x: 0.5, y: 0.78, rx: 0.07, ry: 0.06, suv: 14.0, slices: [11, 14] }, // bladder (excretion)
];

// The malignant lesion of interest.
const LESION: Blob = {
  x: 0.6,
  y: 0.46,
  rx: 0.035,
  ry: 0.035,
  suv: 9.0,
  slices: [5, 9],
};

function blobValue(b: Blob, sliceIdx: number, fx: number, fy: number): number {
  if (sliceIdx < b.slices[0] || sliceIdx > b.slices[1]) return 0;
  const dx = (fx - b.x) / b.rx;
  const dy = (fy - b.y) / b.ry;
  const d2 = dx * dx + dy * dy;
  // Smooth (super-Gaussian) profile with soft edges.
  return b.suv * Math.exp(-Math.pow(d2, 1.4));
}

export function makePhantomStudy(): PetStudy {
  const rand = rng(12345);
  const slices: PetSlice[] = [];
  let studyMax = 0;

  for (let s = 0; s < NUM_SLICES; s++) {
    const suv = new Float32Array(N * N);
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const fx = x / (N - 1);
        const fy = y / (N - 1);
        let v = 0;
        for (const b of ANATOMY) v = Math.max(v, blobValue(b, s, fx, fy));
        v = Math.max(v, blobValue(LESION, s, fx, fy));
        // Poisson-like multiplicative noise where there is signal.
        if (v > 0.05) {
          const noise = 1 + (rand() - 0.5) * 0.28;
          v *= noise;
        }
        if (v < 0) v = 0;
        suv[y * N + x] = v;
        if (v > studyMax) studyMax = v;
      }
    }
    slices.push({
      rows: N,
      cols: N,
      suv,
      sliceLocation: s * 5,
      instanceNumber: s + 1,
    });
  }

  return {
    id: "study-demo-phantom",
    patientId: "DEMO-001",
    patientName: "Demo Fantom (sintetički)",
    patientWeightKg: 75,
    injectedDoseBq: 300e6, // 300 MBq
    halfLifeSec: 6586.2,
    uptakeMinutes: 60,
    units: "BQML",
    suvValid: true,
    slices,
    suvMax: studyMax,
    createdAt: Date.now(),
    isDemo: true,
    seriesDescription: "Sintetički FDG fantom (60 min uptake)",
    scannerModel: "Simulacija",
  };
}

/** Best default lesion ROI for the phantom (voxel coords on the lesion's slice). */
export const PHANTOM_LESION_ROI = {
  slice: 7,
  cx: Math.round(LESION.x * (N - 1)),
  cy: Math.round(LESION.y * (N - 1)),
  r: Math.round(LESION.rx * (N - 1)) + 2,
};
