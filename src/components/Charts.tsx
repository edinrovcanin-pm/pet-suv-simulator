"use client";

import {
  Line,
  LineChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
} from "recharts";
import type { TimePoint } from "@/lib/types";

interface Props {
  points: TimePoint[];
  optimalMinutes: number;
  measuredUptake: number;
}

const axisStyle = { fontSize: 11, fill: "#94a3b8" };
const gridStroke = "#1e293b";

function ChartCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      <h3 className="text-sm font-semibold text-slate-100">{title}</h3>
      <p className="mb-2 text-xs text-slate-400">{subtitle}</p>
      <div className="h-52 w-full">
        <ResponsiveContainer width="100%" height="100%">
          {children as React.ReactElement}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default function Charts({ points, optimalMinutes, measuredUptake }: Props) {
  const commonLines = (
    <>
      <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
      <XAxis
        dataKey="minutes"
        type="number"
        domain={["dataMin", "dataMax"]}
        tick={axisStyle}
        label={{ value: "Uptake (min)", position: "insideBottom", offset: -4, fill: "#64748b", fontSize: 11 }}
      />
      <Tooltip
        contentStyle={{
          background: "#0f172a",
          border: "1px solid #334155",
          borderRadius: 8,
          fontSize: 12,
        }}
        labelFormatter={(v) => `${v} min`}
        formatter={(v) => (typeof v === "number" ? v.toFixed(2) : String(v))}
      />
      <ReferenceLine x={optimalMinutes} stroke="#22c55e" strokeDasharray="4 3" label={{ value: "opt", fill: "#22c55e", fontSize: 10 }} />
      <ReferenceLine x={measuredUptake} stroke="#64748b" strokeDasharray="2 2" />
    </>
  );

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <ChartCard title="SUV vs vrijeme uptake" subtitle="Lezija raste, pozadina se ispire (decay-korigovano)">
        <LineChart data={points} margin={{ top: 5, right: 12, bottom: 16, left: -8 }}>
          {commonLines}
          <YAxis tick={axisStyle} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Line type="monotone" dataKey="lesionSuvMax" name="Lezija SUVmax" stroke="#f97316" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="backgroundSuvMean" name="Pozadina SUVmean" stroke="#38bdf8" strokeWidth={2} dot={false} />
        </LineChart>
      </ChartCard>

      <ChartCard title="Tumor-to-background ratio (TBR)" subtitle="Kontrast lezije — raste s dužim uptake vremenom">
        <LineChart data={points} margin={{ top: 5, right: 12, bottom: 16, left: -8 }}>
          {commonLines}
          <YAxis tick={axisStyle} />
          <Line type="monotone" dataKey="tbr" name="TBR" stroke="#a78bfa" strokeWidth={2} dot={false} />
        </LineChart>
      </ChartCard>

      <ChartCard title="Šum i broj događaja" subtitle="F-18 se raspada → manje događaja i veći šum na dužem uptake-u">
        <LineChart data={points} margin={{ top: 5, right: 12, bottom: 16, left: -8 }}>
          {commonLines}
          <YAxis tick={axisStyle} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Line type="monotone" dataKey="relativeNoise" name="Rel. šum" stroke="#ef4444" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="relativeCounts" name="Rel. događaji" stroke="#eab308" strokeWidth={2} dot={false} />
        </LineChart>
      </ChartCard>

      <ChartCard title="CNR — detektabilnost lezije" subtitle="Kontrast / šum. Maksimum = optimalno vrijeme uptake-a">
        <LineChart data={points} margin={{ top: 5, right: 12, bottom: 16, left: -8 }}>
          {commonLines}
          <YAxis tick={axisStyle} />
          <Line type="monotone" dataKey="cnr" name="CNR" stroke="#22c55e" strokeWidth={2.5} dot={{ r: 2 }} />
        </LineChart>
      </ChartCard>
    </div>
  );
}
