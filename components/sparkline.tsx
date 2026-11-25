import { cn } from "@/lib/utils";

export function Sparkline({
  values,
  width = 120,
  height = 32,
  positive = true,
  color,
  className,
}: {
  values: number[];
  width?: number;
  height?: number;
  positive?: boolean;
  color?: string;
  className?: string;
}) {
  if (!values.length) return null;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const step = values.length > 1 ? width / (values.length - 1) : width;
  const points = values.map((v, i) => {
    const x = i * step;
    const y = height - 3 - ((v - min) / range) * (height - 6);
    return [x, y] as const;
  });
  const line = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${width},${height} L0,${height} Z`;
  const stroke = color ?? (positive ? "#60A5FA" : "#FB7185");
  const id = `spark-${stroke.replace("#", "")}-${values.length}-${Math.round(values[values.length - 1]! * 100)}`;
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className={cn("overflow-visible", className)}
      aria-hidden
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.28" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke={stroke} strokeWidth="1.3" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={points[points.length - 1]![0]} cy={points[points.length - 1]![1]} r="1.8" fill={stroke} />
    </svg>
  );
}
