// PET display colormaps. Each maps a normalized value [0,1] to [r,g,b] 0-255.

export type ColormapName = "hot" | "pet" | "gray" | "invGray";

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Classic "hot metal" scale used widely in nuclear medicine. */
function hot(t: number): [number, number, number] {
  t = clamp01(t);
  const r = clamp01(t / 0.4) * 255;
  const g = clamp01((t - 0.4) / 0.4) * 255;
  const b = clamp01((t - 0.8) / 0.2) * 255;
  return [r, g, b];
}

/** PET "rainbow"-ish scale (blue -> green -> yellow -> red -> white). */
function pet(t: number): [number, number, number] {
  t = clamp01(t);
  // Piecewise linear through control colors.
  const stops: Array<[number, [number, number, number]]> = [
    [0.0, [0, 0, 0]],
    [0.15, [0, 0, 140]],
    [0.35, [0, 170, 180]],
    [0.55, [0, 200, 50]],
    [0.7, [240, 230, 0]],
    [0.85, [255, 90, 0]],
    [1.0, [255, 255, 255]],
  ];
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const [t0, c0] = stops[i - 1];
      const [t1, c1] = stops[i];
      const f = (t - t0) / (t1 - t0 || 1);
      return [
        c0[0] + (c1[0] - c0[0]) * f,
        c0[1] + (c1[1] - c0[1]) * f,
        c0[2] + (c1[2] - c0[2]) * f,
      ];
    }
  }
  return [255, 255, 255];
}

function gray(t: number): [number, number, number] {
  const v = clamp01(t) * 255;
  return [v, v, v];
}

function invGray(t: number): [number, number, number] {
  const v = (1 - clamp01(t)) * 255;
  return [v, v, v];
}

export function applyColormap(
  name: ColormapName,
  t: number
): [number, number, number] {
  switch (name) {
    case "hot":
      return hot(t);
    case "pet":
      return pet(t);
    case "gray":
      return gray(t);
    case "invGray":
      return invGray(t);
    default:
      return hot(t);
  }
}

/** Build a small horizontal gradient (for a legend bar), width samples. */
export function colormapGradient(name: ColormapName, width: number): string {
  const stops: string[] = [];
  for (let i = 0; i <= width; i++) {
    const t = i / width;
    const [r, g, b] = applyColormap(name, t);
    stops.push(`rgb(${r | 0},${g | 0},${b | 0}) ${((t * 100) | 0)}%`);
  }
  return `linear-gradient(to right, ${stops.join(",")})`;
}
