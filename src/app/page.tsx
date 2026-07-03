"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PetCanvas from "@/components/PetCanvas";
import Charts from "@/components/Charts";
import { colormapGradient, type ColormapName } from "@/lib/colormaps";
import { parseDicomFiles } from "@/lib/dicom";
import { makePhantomStudy, PHANTOM_LESION_ROI } from "@/lib/phantom";
import {
  deleteStudy,
  getStudy,
  listStudies,
  saveStudy,
  type StudySummary,
} from "@/lib/db";
import {
  buildTimeCurve,
  DEFAULT_TIMES,
  findOptimal,
  roiStats,
  simulateSlice,
  suvAtTime,
  TISSUE_EXPONENT,
  TISSUE_LABEL,
  type TissueClass,
} from "@/lib/suvModel";
import type { PetStudy, RoiCircle } from "@/lib/types";

const LESION_COLOR = "#f97316";
const BG_COLOR = "#38bdf8";

export default function Home() {
  const [studies, setStudies] = useState<StudySummary[]>([]);
  const [study, setStudy] = useState<PetStudy | null>(null);
  const [sliceIndex, setSliceIndex] = useState(0);
  const [simMinutes, setSimMinutes] = useState(90);
  const [colormap, setColormap] = useState<ColormapName>("hot");
  const [windowMax, setWindowMax] = useState(5);
  const [lesionRoi, setLesionRoi] = useState<RoiCircle | null>(null);
  const [bgRoi, setBgRoi] = useState<RoiCircle | null>(null);
  const [placeMode, setPlaceMode] = useState<"lesion" | "bg" | null>(null);
  const [lesionClass, setLesionClass] = useState<TissueClass>("tumor");
  const [bgClass, setBgClass] = useState<TissueClass>("blood");
  const [countMatched, setCountMatched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refMinutes = study?.uptakeMinutes ?? 60;

  const refreshList = useCallback(async () => {
    setStudies(await listStudies());
  }, []);

  function loadStudy(s: PetStudy) {
    setStudy(s);
    // Find the hottest voxel across the study to auto-place the lesion ROI.
    let bestSlice = 0;
    let bestVal = -1;
    let bestIdx = 0;
    s.slices.forEach((sl, si) => {
      for (let i = 0; i < sl.suv.length; i++) {
        if (sl.suv[i] > bestVal) {
          bestVal = sl.suv[i];
          bestSlice = si;
          bestIdx = i;
        }
      }
    });
    const cols = s.slices[bestSlice].cols;
    const rows = s.slices[bestSlice].rows;
    const r = Math.max(3, Math.round(cols * 0.04));

    if (s.isDemo) {
      setSliceIndex(PHANTOM_LESION_ROI.slice);
      setLesionRoi({
        cx: PHANTOM_LESION_ROI.cx,
        cy: PHANTOM_LESION_ROI.cy,
        r: PHANTOM_LESION_ROI.r,
      });
      setBgRoi({ cx: Math.round(cols * 0.38), cy: Math.round(rows * 0.5), r: r + 2 });
    } else {
      setSliceIndex(bestSlice);
      setLesionRoi({ cx: bestIdx % cols, cy: Math.floor(bestIdx / cols), r });
      setBgRoi({ cx: Math.round(cols * 0.4), cy: Math.round(rows * 0.55), r: r + 2 });
    }
    setWindowMax(Math.max(3, +(s.suvMax * 0.45).toFixed(1)));
    setSimMinutes(Math.round(s.uptakeMinutes >= 60 ? 90 : 60));
    setPlaceMode(null);
    setError(null);
  }

  // On first load: ensure a demo phantom exists, then load the newest study.
  useEffect(() => {
    (async () => {
      let list = await listStudies();
      if (list.length === 0) {
        await saveStudy(makePhantomStudy());
        list = await listStudies();
      }
      setStudies(list);
      const first = await getStudy(list[0].id);
      if (first) loadStudy(first);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const parsed = await parseDicomFiles(Array.from(files));
      await saveStudy(parsed);
      await refreshList();
      loadStudy(parsed);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onSelectStudy(id: string) {
    const s = await getStudy(id);
    if (s) loadStudy(s);
  }

  async function onDelete(id: string) {
    await deleteStudy(id);
    const list = await listStudies();
    setStudies(list);
    if (study?.id === id) {
      if (list.length > 0) {
        const s = await getStudy(list[0].id);
        if (s) loadStudy(s);
      } else {
        setStudy(null);
      }
    }
  }

  async function addDemo() {
    const demo = makePhantomStudy();
    demo.id = `study-demo-${Date.now()}`;
    await saveStudy(demo);
    await refreshList();
    loadStudy(demo);
  }

  const activeSlice = study?.slices[sliceIndex] ?? null;

  const simulatedSuv = useMemo(() => {
    if (!activeSlice) return null;
    return simulateSlice(activeSlice, simMinutes, refMinutes);
  }, [activeSlice, simMinutes, refMinutes]);

  const lesionStats = useMemo(
    () => (activeSlice && lesionRoi ? roiStats(activeSlice, lesionRoi) : null),
    [activeSlice, lesionRoi]
  );
  const bgStats = useMemo(
    () => (activeSlice && bgRoi ? roiStats(activeSlice, bgRoi) : null),
    [activeSlice, bgRoi]
  );

  const curve = useMemo(() => {
    if (!lesionStats || !bgStats) return [];
    const times = Array.from(
      new Set([...DEFAULT_TIMES, Math.round(refMinutes)])
    ).sort((a, b) => a - b);
    return buildTimeCurve({
      lesionSuvRefMax: lesionStats.max,
      lesionSuvRefMean: lesionStats.mean,
      bgSuvRefMean: bgStats.mean,
      bgCovRef: bgStats.cov,
      lesionClass,
      bgClass,
      times,
      refMinutes,
      countMatched,
    });
  }, [lesionStats, bgStats, lesionClass, bgClass, countMatched, refMinutes]);

  const optimal = useMemo(
    () => (curve.length ? findOptimal(curve, refMinutes) : null),
    [curve, refMinutes]
  );

  // ROI values projected to the currently-simulated uptake time.
  const simLesionMax = lesionStats
    ? suvAtTime(lesionStats.max, simMinutes, TISSUE_EXPONENT[lesionClass], refMinutes)
    : 0;
  const simBgMean = bgStats
    ? suvAtTime(bgStats.mean, simMinutes, TISSUE_EXPONENT[bgClass], refMinutes)
    : 0;
  const simTbr = simBgMean > 0 ? simLesionMax / simBgMean : 0;

  function onPlace(cx: number, cy: number) {
    if (placeMode === "lesion") setLesionRoi((r) => ({ cx, cy, r: r?.r ?? 5 }));
    else if (placeMode === "bg") setBgRoi((r) => ({ cx, cy, r: r?.r ?? 7 }));
    setPlaceMode(null);
  }

  const rois = [
    lesionRoi && { ...lesionRoi, color: LESION_COLOR, label: "Lezija" },
    bgRoi && { ...bgRoi, color: BG_COLOR, label: "Pozadina" },
  ].filter(Boolean) as Array<RoiCircle & { color: string; label: string }>;

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6 lg:px-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-white lg:text-3xl">
          PET/CT SUV — simulator vremena uptake-a
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-400">
          Učitaj DICOM PET snimke (¹⁸F-FDG, standardno ~60 min uptake) i simuliraj kako
          bi izgledali SUV i kvalitet slike na kraćim i dužim vremenima uptake-a. Cilj:
          procijeniti optimalno vrijeme uptake-a za detektabilnost lezije i tačnu SUV
          kvantifikaciju. Sve procesiranje je lokalno u browseru — snimci se ne šalju na
          server.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        {/* Sidebar: patient database */}
        <aside className="space-y-4">
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <h2 className="mb-3 text-sm font-semibold text-slate-100">Baza pacijenata</h2>
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                handleFiles(e.dataTransfer.files);
              }}
              onClick={() => fileRef.current?.click()}
              className="cursor-pointer rounded-lg border-2 border-dashed border-slate-700 p-4 text-center text-xs text-slate-400 transition hover:border-slate-500 hover:text-slate-300"
            >
              {busy
                ? "Učitavanje…"
                : "Prevuci DICOM (.dcm) fajlove ovdje ili klikni za odabir"}
              <input
                ref={fileRef}
                type="file"
                multiple
                accept=".dcm,application/dicom"
                className="hidden"
                onChange={(e) => handleFiles(e.target.files)}
              />
            </div>
            <button
              onClick={addDemo}
              className="mt-2 w-full rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700"
            >
              + Dodaj demo fantom
            </button>
            {error && (
              <p className="mt-2 rounded bg-red-950/60 p-2 text-xs text-red-300">
                {error}
              </p>
            )}
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-2">
            <ul className="space-y-1">
              {studies.map((s) => (
                <li
                  key={s.id}
                  className={`group flex items-center justify-between rounded-lg px-2 py-2 text-xs ${
                    study?.id === s.id ? "bg-slate-800" : "hover:bg-slate-800/50"
                  }`}
                >
                  <button
                    onClick={() => onSelectStudy(s.id)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="truncate font-medium text-slate-100">
                      {s.patientName}
                      {s.isDemo && <span className="ml-1 text-emerald-400">(demo)</span>}
                    </div>
                    <div className="truncate text-slate-500">
                      {s.sliceCount} slice · {Math.round(s.uptakeMinutes)} min ·{" "}
                      {s.suvValid ? "SUV ✓" : "rel."}
                    </div>
                  </button>
                  <button
                    onClick={() => onDelete(s.id)}
                    className="ml-1 rounded px-1.5 py-0.5 text-slate-600 opacity-0 transition hover:bg-red-950 hover:text-red-400 group-hover:opacity-100"
                    title="Obriši"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {study && (
            <div className="space-y-1 rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-xs text-slate-400">
              <div className="mb-1 font-semibold text-slate-200">Podaci studije</div>
              <Row k="Pacijent" v={study.patientName} />
              <Row
                k="Težina"
                v={study.patientWeightKg ? `${study.patientWeightKg} kg` : "—"}
              />
              <Row
                k="Doza"
                v={
                  study.injectedDoseBq
                    ? `${(study.injectedDoseBq / 1e6).toFixed(0)} MBq`
                    : "—"
                }
              />
              <Row k="Uptake (izmjereno)" v={`${study.uptakeMinutes.toFixed(0)} min`} />
              <Row k="Jedinice" v={study.units} />
              <Row k="SUV kvantifikacija" v={study.suvValid ? "validna" : "relativna"} />
              {study.suvNote && (
                <p className="mt-1 rounded bg-amber-950/40 p-2 text-amber-300">
                  ⚠ {study.suvNote}
                </p>
              )}
            </div>
          )}
        </aside>

        {/* Main panel */}
        <main className="space-y-6">
          {!study || !activeSlice ? (
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-10 text-center text-slate-400">
              Učitaj studiju iz baze da počneš.
            </div>
          ) : (
            <>
              {/* Optimal recommendation */}
              {optimal && (
                <div className="rounded-xl border border-emerald-800/50 bg-emerald-950/30 p-4">
                  <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
                    <div>
                      <span className="text-xs uppercase tracking-wide text-emerald-500">
                        Procijenjeno optimalno vrijeme uptake-a
                      </span>
                      <div className="text-3xl font-bold text-emerald-300">
                        {optimal.optimalMinutes} min
                      </div>
                    </div>
                    <div className="text-sm text-slate-300">
                      Maksimalna detektabilnost (CNR) lezije.{" "}
                      {optimal.gainVsRefPct > 0.5 ? (
                        <>
                          +{optimal.gainVsRefPct.toFixed(0)}% CNR u odnosu na izmjerenih{" "}
                          {refMinutes.toFixed(0)} min.
                        </>
                      ) : optimal.gainVsRefPct < -0.5 ? (
                        <>Izmjerenih {refMinutes.toFixed(0)} min je već blizu optimuma.</>
                      ) : (
                        <>Blizu izmjerenog vremena.</>
                      )}
                    </div>
                  </div>
                  <p className="mt-2 text-xs text-slate-500">
                    Model: SUV(t) = SUV(ref)·(t/ref)<sup>a</sup> po tkivu (tumor a=+0.25,
                    krvni pool −0.15, jetra −0.10), šum ∝ e<sup>+λ(t−ref)/2</sup> (F-18 T½
                    109.77 min). CNR = kontrast / šum.
                  </p>
                </div>
              )}

              {/* Viewers */}
              <div className="grid gap-4 md:grid-cols-2">
                <ViewerCard
                  title={`Original — ${refMinutes.toFixed(0)} min (izmjereno)`}
                  suvMax={lesionStats?.max}
                >
                  <PetCanvas
                    suv={activeSlice.suv}
                    rows={activeSlice.rows}
                    cols={activeSlice.cols}
                    windowMax={windowMax}
                    colormap={colormap}
                    rois={rois}
                    onPlace={placeMode ? onPlace : undefined}
                  />
                </ViewerCard>
                <ViewerCard
                  title={`Simulacija — ${simMinutes} min`}
                  suvMax={simLesionMax}
                  highlight
                >
                  {simulatedSuv && (
                    <PetCanvas
                      suv={simulatedSuv}
                      rows={activeSlice.rows}
                      cols={activeSlice.cols}
                      windowMax={windowMax}
                      colormap={colormap}
                      rois={rois}
                    />
                  )}
                </ViewerCard>
              </div>

              {/* Time slider + live SUV readout */}
              <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                <div className="flex items-center justify-between text-sm">
                  <label className="font-medium text-slate-200">
                    Simulirano vrijeme uptake-a: {simMinutes} min
                  </label>
                  {optimal && (
                    <button
                      onClick={() => setSimMinutes(optimal.optimalMinutes)}
                      className="rounded-lg bg-emerald-800/60 px-3 py-1 text-xs font-medium text-emerald-200 hover:bg-emerald-700/60"
                    >
                      Skoči na optimalno ({optimal.optimalMinutes} min)
                    </button>
                  )}
                </div>
                <input
                  type="range"
                  min={20}
                  max={200}
                  step={5}
                  value={simMinutes}
                  onChange={(e) => setSimMinutes(+e.target.value)}
                  className="mt-2 w-full"
                />
                <div className="mt-3 grid grid-cols-3 gap-3 text-center">
                  <Stat
                    label="Lezija SUVmax"
                    value={simLesionMax.toFixed(2)}
                    color={LESION_COLOR}
                  />
                  <Stat
                    label="Pozadina SUVmean"
                    value={simBgMean.toFixed(2)}
                    color={BG_COLOR}
                  />
                  <Stat label="TBR" value={simTbr.toFixed(2)} color="#a78bfa" />
                </div>
              </div>

              {/* Controls */}
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                <Control label={`Slice: ${sliceIndex + 1} / ${study.slices.length}`}>
                  <input
                    type="range"
                    min={0}
                    max={study.slices.length - 1}
                    value={sliceIndex}
                    onChange={(e) => setSliceIndex(+e.target.value)}
                    className="w-full"
                  />
                </Control>

                <Control label={`SUV prozor (max): ${windowMax.toFixed(1)}`}>
                  <input
                    type="range"
                    min={1}
                    max={Math.max(5, Math.ceil(study.suvMax))}
                    step={0.5}
                    value={windowMax}
                    onChange={(e) => setWindowMax(+e.target.value)}
                    className="w-full"
                  />
                  <div
                    className="mt-1 h-2 w-full rounded"
                    style={{ backgroundImage: colormapGradient(colormap, 40) }}
                  />
                </Control>

                <Control label="Colormap">
                  <select
                    value={colormap}
                    onChange={(e) => setColormap(e.target.value as ColormapName)}
                    className="w-full rounded-lg bg-slate-800 px-2 py-1.5 text-sm text-slate-200"
                  >
                    <option value="hot">Hot metal</option>
                    <option value="pet">PET (rainbow)</option>
                    <option value="gray">Sivo</option>
                    <option value="invGray">Inverzno sivo</option>
                  </select>
                </Control>

                <Control label="Lezija ROI">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() =>
                        setPlaceMode(placeMode === "lesion" ? null : "lesion")
                      }
                      className={`flex-1 rounded-lg px-2 py-1.5 text-xs font-medium ${
                        placeMode === "lesion"
                          ? "bg-orange-600 text-white"
                          : "bg-slate-800 text-slate-200 hover:bg-slate-700"
                      }`}
                    >
                      {placeMode === "lesion" ? "Klikni na sliku…" : "Postavi lezija ROI"}
                    </button>
                    <RadiusButtons
                      onDelta={(d) =>
                        setLesionRoi((r) => (r ? { ...r, r: Math.max(1, r.r + d) } : r))
                      }
                    />
                  </div>
                  <select
                    value={lesionClass}
                    onChange={(e) => setLesionClass(e.target.value as TissueClass)}
                    className="mt-2 w-full rounded-lg bg-slate-800 px-2 py-1 text-xs text-slate-200"
                  >
                    {(["tumor", "inflammation", "muscle"] as TissueClass[]).map((c) => (
                      <option key={c} value={c}>
                        {TISSUE_LABEL[c]} (a={TISSUE_EXPONENT[c]})
                      </option>
                    ))}
                  </select>
                </Control>

                <Control label="Pozadina ROI">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setPlaceMode(placeMode === "bg" ? null : "bg")}
                      className={`flex-1 rounded-lg px-2 py-1.5 text-xs font-medium ${
                        placeMode === "bg"
                          ? "bg-sky-600 text-white"
                          : "bg-slate-800 text-slate-200 hover:bg-slate-700"
                      }`}
                    >
                      {placeMode === "bg" ? "Klikni na sliku…" : "Postavi pozadina ROI"}
                    </button>
                    <RadiusButtons
                      onDelta={(d) =>
                        setBgRoi((r) => (r ? { ...r, r: Math.max(1, r.r + d) } : r))
                      }
                    />
                  </div>
                  <select
                    value={bgClass}
                    onChange={(e) => setBgClass(e.target.value as TissueClass)}
                    className="mt-2 w-full rounded-lg bg-slate-800 px-2 py-1 text-xs text-slate-200"
                  >
                    {(["blood", "liver", "muscle"] as TissueClass[]).map((c) => (
                      <option key={c} value={c}>
                        {TISSUE_LABEL[c]} (a={TISSUE_EXPONENT[c]})
                      </option>
                    ))}
                  </select>
                </Control>

                <Control label="Scenarij šuma">
                  <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-300">
                    <input
                      type="checkbox"
                      checked={countMatched}
                      onChange={(e) => setCountMatched(e.target.checked)}
                    />
                    Konstantan broj događaja (produženo snimanje)
                  </label>
                  <p className="mt-1 text-[11px] leading-tight text-slate-500">
                    {countMatched
                      ? "Trajanje snimanja se produžava da kompenzuje raspad — šum ostaje ~konstantan."
                      : "Fiksno trajanje snimanja — na dužem uptake-u ima manje događaja, šum raste."}
                  </p>
                </Control>
              </div>

              {/* Charts */}
              {curve.length > 0 && optimal && (
                <Charts
                  points={curve}
                  optimalMinutes={optimal.optimalMinutes}
                  measuredUptake={refMinutes}
                />
              )}

              {/* ROI measurement table */}
              {lesionStats && bgStats && (
                <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                  <h3 className="mb-2 text-sm font-semibold text-slate-100">
                    Izmjerene ROI vrijednosti (@ {refMinutes.toFixed(0)} min)
                  </h3>
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs text-slate-500">
                      <tr>
                        <th className="py-1">ROI</th>
                        <th>SUVmax</th>
                        <th>SUVmean</th>
                        <th>SD</th>
                        <th>CoV</th>
                        <th>voxela</th>
                      </tr>
                    </thead>
                    <tbody className="text-slate-200">
                      <tr>
                        <td className="py-1" style={{ color: LESION_COLOR }}>
                          Lezija
                        </td>
                        <td>{lesionStats.max.toFixed(2)}</td>
                        <td>{lesionStats.mean.toFixed(2)}</td>
                        <td>{lesionStats.std.toFixed(2)}</td>
                        <td>{(lesionStats.cov * 100).toFixed(0)}%</td>
                        <td>{lesionStats.count}</td>
                      </tr>
                      <tr>
                        <td className="py-1" style={{ color: BG_COLOR }}>
                          Pozadina
                        </td>
                        <td>{bgStats.max.toFixed(2)}</td>
                        <td>{bgStats.mean.toFixed(2)}</td>
                        <td>{bgStats.std.toFixed(2)}</td>
                        <td>{(bgStats.cov * 100).toFixed(0)}%</td>
                        <td>{bgStats.count}</td>
                      </tr>
                    </tbody>
                  </table>
                  {!study.suvValid && (
                    <p className="mt-2 text-xs text-amber-400">
                      ⚠ Vrijednosti su relativne (SUV se nije mogao izračunati iz DICOM
                      metapodataka). Oblici krivulja i optimalno vrijeme i dalje vrijede.
                    </p>
                  )}
                </div>
              )}

              <Disclaimer />
            </>
          )}
        </main>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-slate-500">{k}</span>
      <span className="text-right text-slate-300">{v}</span>
    </div>
  );
}

function Control({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
      <div className="mb-2 text-xs font-medium text-slate-300">{label}</div>
      {children}
    </div>
  );
}

function Stat({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="rounded-lg bg-slate-800/60 py-2">
      <div className="text-lg font-bold" style={{ color }}>
        {value}
      </div>
      <div className="text-[11px] text-slate-400">{label}</div>
    </div>
  );
}

function RadiusButtons({ onDelta }: { onDelta: (d: number) => void }) {
  return (
    <div className="flex overflow-hidden rounded-lg border border-slate-700">
      <button
        onClick={() => onDelta(-1)}
        className="bg-slate-800 px-2 py-1.5 text-xs text-slate-200 hover:bg-slate-700"
      >
        −
      </button>
      <button
        onClick={() => onDelta(1)}
        className="bg-slate-800 px-2 py-1.5 text-xs text-slate-200 hover:bg-slate-700"
      >
        +
      </button>
    </div>
  );
}

function ViewerCard({
  title,
  suvMax,
  highlight,
  children,
}: {
  title: string;
  suvMax?: number;
  highlight?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`rounded-xl border p-3 ${
        highlight
          ? "border-emerald-800/50 bg-emerald-950/20"
          : "border-slate-800 bg-slate-900/60"
      }`}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium text-slate-200">{title}</span>
        {suvMax != null && (
          <span className="text-xs text-slate-400">SUVmax {suvMax.toFixed(2)}</span>
        )}
      </div>
      {children}
    </div>
  );
}

function Disclaimer() {
  return (
    <p className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 text-xs leading-relaxed text-slate-500">
      <strong className="text-slate-400">Napomena:</strong> Ovo je edukativno-istraživački
      alat za simulaciju. Retencioni eksponenti po tkivu su konsolidovani iz heterogene
      literature (dual-time-point studije, dinamička PET kinetika) i predstavljaju
      podesive priore, ne pacijent-specifične vrijednosti. Prave vrijednosti zavise od
      tipa tumora, skenera i ulazne funkcije. Alat nije za kliničku dijagnostiku.
    </p>
  );
}
