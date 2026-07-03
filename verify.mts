/* Correctness verification: model math + DICOM SUV pipeline.
   Run: npx tsx verify.ts */
import { readFileSync } from "node:fs";
import {
  suvAtTime,
  relativeCounts,
  relativeNoise,
  retentionExponentForSuv,
  roiStats,
  buildTimeCurve,
  findOptimal,
  simulateSlice,
  LAMBDA_PER_MIN,
  DEFAULT_TIMES,
} from "./src/lib/suvModel";
import { parseDicomFiles } from "./src/lib/dicom";
import type { PetSlice } from "./src/lib/types";

let pass = 0;
let fail = 0;
const fails: string[] = [];

function ok(name: string, cond: boolean, detail = "") {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    fails.push(name + (detail ? ` — ${detail}` : ""));
    console.log(`  ✗ ${name}  ${detail}`);
  }
}
function approx(name: string, got: number, exp: number, tol = 1e-4) {
  ok(name, Math.abs(got - exp) <= tol, `got ${got}, expected ${exp} (tol ${tol})`);
}

console.log("\n=== 1. Fizikalne konstante ===");
approx("λ = ln2/109.77", LAMBDA_PER_MIN, Math.LN2 / 109.77, 1e-9);

console.log("\n=== 2. suvAtTime (power-law biologija) ===");
approx("SUV(120|a=.25,ref60) = 2^0.25", suvAtTime(1, 120, 0.25, 60), Math.pow(2, 0.25));
approx("SUV(t=ref) = SUV_ref", suvAtTime(5, 60, 0.25, 60), 5);
approx("SUV(120|a=-.15) blood washout", suvAtTime(2, 120, -0.15, 60), 2 * Math.pow(2, -0.15));
approx("SUV(0)=0 (guard)", suvAtTime(0, 120, 0.25, 60), 0);
approx("ref≠60: SUV(90|ref45,a=.25)", suvAtTime(3, 90, 0.25, 45), 3 * Math.pow(2, 0.25));

console.log("\n=== 3. Raspad / šum ===");
approx("relCounts(120,60)=exp(-λ·60)", relativeCounts(120, 60), Math.exp(-LAMBDA_PER_MIN * 60));
approx("relCounts=0.6847 (lit. 0.685)", relativeCounts(120, 60), 0.68466, 1e-3);
approx("relCounts(ref)=1", relativeCounts(60, 60), 1);
approx("relNoise(120)=1/sqrt(counts) ≈ +21%", relativeNoise(120, false, 60), 1.20856, 1e-3);
approx("relNoise countMatched=1", relativeNoise(120, true, 60), 1);
ok("relNoise>1 na dužem uptake-u", relativeNoise(90, false, 60) > 1);

console.log("\n=== 4. retentionExponentForSuv (sigmoid) ===");
approx("SUV=3.5 (S_MID) → 0.05", retentionExponentForSuv(3.5), 0.05, 1e-6);
// Sigmoid asymptote is -0.15 only as SUV→-∞; for realistic low SUV the effective
// washout floor is ~-0.13. Assert it is clearly negative (washout), near the floor.
ok("nizak SUV → washout (~ -0.13)",
  retentionExponentForSuv(0.3) < -0.12 && retentionExponentForSuv(0.3) > -0.15);
ok("visok SUV → ~ +0.25 (uptake)", Math.abs(retentionExponentForSuv(12) - 0.25) < 0.02);
ok("monotono rastuće po SUV", retentionExponentForSuv(1) < retentionExponentForSuv(5));

console.log("\n=== 5. roiStats ===");
{
  // 5x5 slice, central 3x3 = value 10, rest 2.
  const s: PetSlice = {
    rows: 5, cols: 5, suv: new Float32Array(25).fill(2),
    sliceLocation: 0, instanceNumber: 1,
  };
  for (let y = 1; y <= 3; y++) for (let x = 1; x <= 3; x++) s.suv[y * 5 + x] = 10;
  const st = roiStats(s, { cx: 2, cy: 2, r: 1.5 });
  // radius 1.5 around center covers the 3x3 block minus corners (dist>1.5): 5 voxels all =10
  approx("ROI max", st.max, 10);
  approx("ROI mean (svi =10)", st.mean, 10);
  approx("ROI std=0 na uniformnom", st.std, 0);
  const full = roiStats(s, { cx: 2, cy: 2, r: 10 });
  approx("ROI mean cijele slike", full.mean, (9 * 10 + 16 * 2) / 25, 1e-4);
  ok("CoV>0 na nehomogenom", full.cov > 0);
}

console.log("\n=== 6. simulateSlice ===");
{
  const s: PetSlice = {
    rows: 2, cols: 2, suv: new Float32Array([0, 1, 8, 3.5]),
    sliceLocation: 0, instanceNumber: 1,
  };
  const out = simulateSlice(s, 120, 60);
  approx("zero ostaje zero", out[0], 0);
  approx("SUV=8 raste (~tumor a→.25)", out[2], 8 * Math.pow(2, retentionExponentForSuv(8)), 0.02);
  approx("SUV=3.5 (mid) → a=0.05", out[3], 3.5 * Math.pow(2, 0.05), 0.02);
  ok("niska pozadina (1.0) se ispire (<1)", out[1] < 1);
}

console.log("\n=== 7. buildTimeCurve + findOptimal ===");
{
  const times = [...DEFAULT_TIMES];
  const base = {
    lesionSuvRefMax: 8, lesionSuvRefMean: 6, bgSuvRefMean: 2,
    bgCovRef: 0.15, lesionClass: "tumor" as const, bgClass: "blood" as const,
    times, refMinutes: 60,
  };
  const fixed = buildTimeCurve({ ...base, countMatched: false });
  const matched = buildTimeCurve({ ...base, countMatched: true });

  ok("TBR raste s vremenom (60<90<120)",
    fixed.find(p => p.minutes === 60)!.tbr < fixed.find(p => p.minutes === 90)!.tbr &&
    fixed.find(p => p.minutes === 90)!.tbr < fixed.find(p => p.minutes === 120)!.tbr);
  ok("lezija SUVmax raste, pozadina pada (120 vs 60)",
    fixed.at(-1)!.lesionSuvMax > fixed[0].lesionSuvMax &&
    fixed.find(p=>p.minutes===120)!.backgroundSuvMean < fixed.find(p=>p.minutes===60)!.backgroundSuvMean);

  const optFixed = findOptimal(fixed, 60);
  const optMatched = findOptimal(matched, 60);
  ok("fixed-duration: optimum je interioran (šum ograničava)",
    optFixed.optimalMinutes > 60 && optFixed.optimalMinutes < Math.max(...times),
    `opt=${optFixed.optimalMinutes}`);
  ok("count-matched: CNR raste monotono → optimum na max vremenu",
    optMatched.optimalMinutes === Math.max(...times), `opt=${optMatched.optimalMinutes}`);
  ok("count-matched CNR(max) > fixed CNR(max) (manje šuma)",
    matched.at(-1)!.cnr > fixed.at(-1)!.cnr);
  ok("gainVsRef definisan", Number.isFinite(optFixed.gainVsRefPct));

  // TBR guard: bg=0
  const zbg = buildTimeCurve({ ...base, bgSuvRefMean: 0, countMatched: false });
  ok("TBR=0 kad je pozadina 0 (nema deljenja s nulom)", zbg.every(p => p.tbr === 0));
}

console.log("\n=== 8. DICOM parsiranje + SUVbw (sintetički fajl) ===");
async function testDicom() {
  const dir = new URL("./test/fixtures/", import.meta.url).pathname;
  const f1 = new File([readFileSync(`${dir}/test_slice1.dcm`)], "test_slice1.dcm");
  const f2 = new File([readFileSync(`${dir}/test_slice2.dcm`)], "test_slice2.dcm");
  const study = await parseDicomFiles([f2, f1]); // pass out of order on purpose

  ok("units = BQML", study.units === "BQML");
  ok("suvValid = true", study.suvValid === true, study.suvNote ?? "");
  approx("težina 70 kg", study.patientWeightKg!, 70);
  approx("doza 370 MBq", study.injectedDoseBq!, 370e6, 1);
  approx("poluživot 6586.2 s", study.halfLifeSec, 6586.2, 0.1);
  approx("uptake 60 min", study.uptakeMinutes, 60, 0.01);
  ok("2 slice-a", study.slices.length === 2);
  ok("sortiranje po sliceLocation (0 pa 5)",
    study.slices[0].sliceLocation === 0 && study.slices[1].sliceLocation === 5);
  approx("SUVmax ≈ 8.0 (lezija)", study.suvMax, 8.0, 0.01);

  const sl = study.slices[0];
  // background voxel (1,1) should be SUV≈1.0; lesion voxel (3,3) ≈8.0; (0,0)=0
  approx("pozadinski voxel SUV≈1.0", sl.suv[1 * sl.cols + 1], 1.0, 0.01);
  approx("lezija voxel SUV≈8.0", sl.suv[3 * sl.cols + 3], 8.0, 0.01);
  approx("nula voxel = 0", sl.suv[0], 0, 1e-6);
  ok("patientName parsiran", study.patientName.includes("Test"));
}

await testDicom();

console.log(`\n=== REZULTAT: ${pass} prošlo, ${fail} palo ===`);
if (fail > 0) {
  console.log("PALO:\n" + fails.map(f => "  - " + f).join("\n"));
  process.exit(1);
}
