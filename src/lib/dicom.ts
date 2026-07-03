// DICOM PET parsing + SUVbw computation, fully client-side (dicom-parser).
//
// SUVbw = C(voxel) / (dose_at_scan / weight_g)
//   C(voxel)     : activity concentration in Bq/mL = slope*stored + intercept (Units=BQML)
//   dose_at_scan : injected dose decay-corrected from injection time to scan start
//                  = RadionuclideTotalDose * 2^(-dt/halfLife)
//   weight_g     : PatientWeight(kg) * 1000  (1 mL tissue ~ 1 g)
//
// This is the QIBA / standard SUVbw definition. PET pixel data is normally already
// decay-corrected to acquisition start (DecayCorrection = START), so the only decay
// term we apply is on the injected dose, from injection to scan.

import dicomParser from "dicom-parser";
import type { PetSlice, PetStudy, PixelUnits } from "./types";

const F18_HALFLIFE_SEC = 6586.2; // 109.77 min

/** Parse a DICOM TM/DT time string (HHMMSS.ffffff) into seconds since midnight. */
function parseDicomTimeToSec(tm: string | undefined): number | null {
  if (!tm) return null;
  // Handle full datetime (YYYYMMDDHHMMSS...) by taking the time portion.
  const t = tm.length > 6 && tm.length >= 14 ? tm.slice(8) : tm;
  const cleaned = t.replace(/[^0-9.]/g, "");
  if (cleaned.length < 6) return null;
  const hh = parseInt(cleaned.slice(0, 2), 10);
  const mm = parseInt(cleaned.slice(2, 4), 10);
  const ss = parseFloat(cleaned.slice(4));
  if (isNaN(hh) || isNaN(mm) || isNaN(ss)) return null;
  return hh * 3600 + mm * 60 + ss;
}

function readUnits(u: string | undefined): PixelUnits {
  if (!u) return "UNKNOWN";
  const t = u.trim().toUpperCase();
  if (t === "BQML") return "BQML";
  if (t === "CNTS") return "CNTS";
  if (t === "GML") return "GML";
  return "UNKNOWN";
}

interface RawInstance {
  rows: number;
  cols: number;
  frames: number;
  slope: number;
  intercept: number;
  stored: Int16Array | Uint16Array;
  sliceLocation: number | null;
  instanceNumber: number | null;
  // shared study-level metadata (same for all instances of a series)
  patientName: string;
  patientId: string;
  weightKg: number | null;
  doseBq: number | null;
  halfLifeSec: number;
  injectionSec: number | null;
  scanSec: number | null;
  units: PixelUnits;
  seriesDescription: string;
  scannerModel: string;
}

function parseInstance(byteArray: Uint8Array): RawInstance {
  const ds = dicomParser.parseDicom(byteArray);

  const rows = ds.uint16("x00280010") ?? 0;
  const cols = ds.uint16("x00280011") ?? 0;
  const frames = parseInt(ds.string("x00280008") || "1", 10) || 1;
  const bitsAllocated = ds.uint16("x00280100") ?? 16;
  const pixelRep = ds.uint16("x00280103") ?? 0; // 0 unsigned, 1 signed
  const slope = parseFloat(ds.string("x00281053") || "1") || 1;
  const intercept = parseFloat(ds.string("x00281052") || "0") || 0;

  const pixelEl = ds.elements.x7fe00010;
  if (!pixelEl) throw new Error("No PixelData element found in DICOM.");

  const numPixels = rows * cols * frames;
  let stored: Int16Array | Uint16Array;
  if (bitsAllocated <= 8) {
    const u8 = new Uint8Array(
      byteArray.buffer,
      pixelEl.dataOffset,
      Math.min(numPixels, pixelEl.length)
    );
    stored = new Uint16Array(u8); // widen
  } else if (pixelRep === 1) {
    stored = new Int16Array(
      byteArray.buffer,
      pixelEl.dataOffset,
      Math.min(numPixels, pixelEl.length / 2)
    );
  } else {
    stored = new Uint16Array(
      byteArray.buffer,
      pixelEl.dataOffset,
      Math.min(numPixels, pixelEl.length / 2)
    );
  }

  // Radiopharmaceutical info sequence (0054,0016)
  let doseBq: number | null = null;
  let halfLifeSec = F18_HALFLIFE_SEC;
  let injectionSec: number | null = null;
  const radSeq = ds.elements.x00540016;
  if (radSeq && radSeq.items && radSeq.items.length > 0) {
    const item = radSeq.items[0].dataSet;
    if (item) {
      const d = parseFloat(item.string("x00181074") || "");
      if (!isNaN(d)) doseBq = d;
      const hl = parseFloat(item.string("x00181075") || "");
      if (!isNaN(hl) && hl > 0) halfLifeSec = hl;
      // Prefer full datetime (0018,1078) then start time (0018,1072)
      injectionSec =
        parseDicomTimeToSec(item.string("x00181078")) ??
        parseDicomTimeToSec(item.string("x00181072"));
    }
  }

  const weightKgRaw = parseFloat(ds.string("x00101030") || "");
  const weightKg = isNaN(weightKgRaw) ? null : weightKgRaw;

  // Scan start time: prefer AcquisitionTime, then SeriesTime.
  const scanSec =
    parseDicomTimeToSec(ds.string("x00080032")) ??
    parseDicomTimeToSec(ds.string("x00080031"));

  const sliceLocationRaw = parseFloat(ds.string("x00201041") || "");
  const instanceNumberRaw = parseInt(ds.string("x00200013") || "", 10);

  return {
    rows,
    cols,
    frames,
    slope,
    intercept,
    stored,
    sliceLocation: isNaN(sliceLocationRaw) ? null : sliceLocationRaw,
    instanceNumber: isNaN(instanceNumberRaw) ? null : instanceNumberRaw,
    patientName: (ds.string("x00100010") || "Anonymous").replace(/\^/g, " ").trim(),
    patientId: ds.string("x00100020") || "unknown",
    weightKg,
    doseBq,
    halfLifeSec,
    injectionSec,
    scanSec,
    units: readUnits(ds.string("x00541001")),
    seriesDescription: ds.string("x0008103e") || "",
    scannerModel: ds.string("x00081090") || "",
  };
}

/** Convert a raw instance's stored pixels into one or more SUV slices. */
function instanceToSlices(
  inst: RawInstance,
  doseAtScanBq: number | null,
  weightG: number | null
): { slices: PetSlice[]; localMax: number } {
  const { rows, cols, frames, slope, intercept, stored, units } = inst;
  const perFrame = rows * cols;
  const slices: PetSlice[] = [];
  let localMax = 0;

  // Scale from concentration to SUV. If we can't (no dose/weight), fall back to
  // raw concentration so the image still displays (flagged suvValid=false upstream).
  const canSuv =
    units === "BQML" && doseAtScanBq != null && weightG != null && doseAtScanBq > 0;
  const suvScale = canSuv ? weightG! / doseAtScanBq! : 1;

  for (let f = 0; f < frames; f++) {
    const suv = new Float32Array(perFrame);
    const off = f * perFrame;
    for (let i = 0; i < perFrame; i++) {
      const conc = stored[off + i] * slope + intercept; // Bq/mL (or raw)
      let v = conc * suvScale;
      if (v < 0) v = 0;
      suv[i] = v;
      if (v > localMax) localMax = v;
    }
    slices.push({
      rows,
      cols,
      suv,
      sliceLocation:
        frames > 1 ? (inst.sliceLocation ?? f) + f : inst.sliceLocation,
      instanceNumber: frames > 1 ? f + 1 : inst.instanceNumber,
    });
  }
  return { slices, localMax };
}

/** Parse a set of DICOM files (one series) into a single PetStudy. */
export async function parseDicomFiles(files: File[]): Promise<PetStudy> {
  const raws: RawInstance[] = [];
  for (const file of files) {
    const buf = new Uint8Array(await file.arrayBuffer());
    try {
      raws.push(parseInstance(buf));
    } catch (e) {
      // Skip non-DICOM / unreadable files but keep going.
      console.warn(`Skipping ${file.name}: ${(e as Error).message}`);
    }
  }
  if (raws.length === 0) {
    throw new Error(
      "Nijedan validan DICOM fajl nije pronađen. Provjeri da su fajlovi PET (.dcm) snimci."
    );
  }

  const head = raws[0];
  const weightG = head.weightKg != null ? head.weightKg * 1000 : null;

  // Uptake delay (min) = scan start - injection.
  let uptakeMinutes = 60;
  let uptakeKnown = false;
  if (head.injectionSec != null && head.scanSec != null) {
    let dt = head.scanSec - head.injectionSec;
    if (dt < 0) dt += 24 * 3600; // crossed midnight
    if (dt > 0 && dt < 6 * 3600) {
      uptakeMinutes = dt / 60;
      uptakeKnown = true;
    }
  }
  const dtSec = uptakeMinutes * 60;
  const doseAtScanBq =
    head.doseBq != null
      ? head.doseBq * Math.pow(2, -dtSec / head.halfLifeSec)
      : null;

  const suvValid =
    head.units === "BQML" && doseAtScanBq != null && weightG != null;

  const allSlices: PetSlice[] = [];
  let studyMax = 0;
  for (const inst of raws) {
    const { slices, localMax } = instanceToSlices(inst, doseAtScanBq, weightG);
    allSlices.push(...slices);
    if (localMax > studyMax) studyMax = localMax;
  }

  // Order slices head-to-foot by slice location / instance number.
  allSlices.sort((a, b) => {
    if (a.sliceLocation != null && b.sliceLocation != null)
      return a.sliceLocation - b.sliceLocation;
    return (a.instanceNumber ?? 0) - (b.instanceNumber ?? 0);
  });

  const notes: string[] = [];
  if (!suvValid) {
    if (head.units !== "BQML")
      notes.push(`jedinice piksela su ${head.units} (nije BQML)`);
    if (head.doseBq == null) notes.push("nedostaje doza (RadionuclideTotalDose)");
    if (weightG == null) notes.push("nedostaje težina pacijenta");
    notes.push("prikaz je u relativnim jedinicama");
  }
  if (!uptakeKnown)
    notes.push("vrijeme uptake nije nađeno u DICOM-u, pretpostavljeno 60 min");

  return {
    id: `study-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    patientId: head.patientId,
    patientName: head.patientName,
    patientWeightKg: head.weightKg,
    injectedDoseBq: head.doseBq,
    halfLifeSec: head.halfLifeSec,
    uptakeMinutes,
    units: head.units,
    suvValid,
    suvNote: notes.length ? notes.join("; ") : undefined,
    slices: allSlices,
    suvMax: studyMax,
    createdAt: Date.now(),
    seriesDescription: head.seriesDescription,
    scannerModel: head.scannerModel,
  };
}
