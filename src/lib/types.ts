// Shared types for the PET/CT SUV uptake-time simulator.

export type PixelUnits = "BQML" | "CNTS" | "GML" | "UNKNOWN";

/** A single reconstructed PET slice with SUV already computed per voxel. */
export interface PetSlice {
  rows: number;
  cols: number;
  /** SUVbw per voxel, row-major, length = rows*cols. */
  suv: Float32Array;
  /** Slice location (mm) if available, for ordering. */
  sliceLocation: number | null;
  /** Instance number if available. */
  instanceNumber: number | null;
}

/** Everything extracted from a PET DICOM series needed for SUV + simulation. */
export interface PetStudy {
  id: string;
  patientId: string;
  patientName: string;
  patientWeightKg: number | null;
  /** Injected activity in Bq (RadionuclideTotalDose). */
  injectedDoseBq: number | null;
  /** Radionuclide half-life in seconds (from DICOM, else assumed F18). */
  halfLifeSec: number;
  /** Measured uptake delay in minutes: scan start - injection time. */
  uptakeMinutes: number;
  units: PixelUnits;
  /** Whether SUV could be quantitatively computed (needs dose + weight). */
  suvValid: boolean;
  /** Reason SUV is not valid, if applicable. */
  suvNote?: string;
  slices: PetSlice[];
  /** Global SUV range across the study, for consistent windowing. */
  suvMax: number;
  createdAt: number;
  /** True for the built-in synthetic demo phantom. */
  isDemo?: boolean;
  seriesDescription?: string;
  scannerModel?: string;
}

/** One point on a simulated uptake-time curve. */
export interface TimePoint {
  minutes: number;
  lesionSuvMax: number;
  lesionSuvMean: number;
  backgroundSuvMean: number;
  /** Tumor-to-background ratio. */
  tbr: number;
  /** Relative image noise (coefficient of variation in background), normalized. */
  relativeNoise: number;
  /** Contrast-to-noise ratio (detectability index). */
  cnr: number;
  /** Relative number of true+scatter counts vs the reference scan. */
  relativeCounts: number;
}

export interface RoiCircle {
  /** Center in voxel coordinates. */
  cx: number;
  cy: number;
  /** Radius in voxels. */
  r: number;
}
