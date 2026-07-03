"use client";

import { useEffect, useRef } from "react";
import { applyColormap, type ColormapName } from "@/lib/colormaps";
import type { RoiCircle } from "@/lib/types";

interface RoiOverlay extends RoiCircle {
  color: string;
  label: string;
}

interface Props {
  suv: Float32Array;
  rows: number;
  cols: number;
  windowMax: number;
  colormap: ColormapName;
  rois?: RoiOverlay[];
  /** Called with voxel coords when the image is clicked. */
  onPlace?: (cx: number, cy: number) => void;
  className?: string;
}

export default function PetCanvas({
  suv,
  rows,
  cols,
  windowMax,
  colormap,
  rois = [],
  onPlace,
  className,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = cols;
    canvas.height = rows;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const img = ctx.createImageData(cols, rows);
    const inv = windowMax > 0 ? 1 / windowMax : 0;
    for (let i = 0; i < suv.length; i++) {
      const t = suv[i] * inv;
      const [r, g, b] = applyColormap(colormap, t);
      const o = i * 4;
      img.data[o] = r;
      img.data[o + 1] = g;
      img.data[o + 2] = b;
      img.data[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }, [suv, rows, cols, windowMax, colormap]);

  function handleClick(e: React.MouseEvent<SVGSVGElement>) {
    if (!onPlace) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * cols;
    const y = ((e.clientY - rect.top) / rect.height) * rows;
    onPlace(Math.round(x), Math.round(y));
  }

  return (
    <div className={`relative ${className ?? ""}`} style={{ aspectRatio: `${cols}/${rows}` }}>
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full rounded-lg"
        style={{ imageRendering: "pixelated" }}
      />
      <svg
        viewBox={`0 0 ${cols} ${rows}`}
        className={`absolute inset-0 h-full w-full ${onPlace ? "cursor-crosshair" : ""}`}
        onClick={handleClick}
        preserveAspectRatio="none"
      >
        {rois.map((roi, i) => (
          <g key={i}>
            <circle
              cx={roi.cx}
              cy={roi.cy}
              r={roi.r}
              fill="none"
              stroke={roi.color}
              strokeWidth={Math.max(0.6, cols / 200)}
            />
            <text
              x={roi.cx + roi.r + 1}
              y={roi.cy}
              fill={roi.color}
              fontSize={Math.max(4, cols / 22)}
              dominantBaseline="middle"
              style={{ paintOrder: "stroke", stroke: "rgba(0,0,0,0.6)", strokeWidth: 0.4 }}
            >
              {roi.label}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
