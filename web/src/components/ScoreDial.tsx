import { gradeColor } from "@/lib/format";
import type { Grade } from "@/types/report";

interface Props {
  score: number;
  grade: Grade;
  size?: number;
  label?: string;
}

export function ScoreDial({ score, grade, size = 200, label = "Общий балл" }: Props) {
  const stroke = size * 0.09;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score)) / 100;
  const offset = c * (1 - pct);
  const color = gradeColor(grade);

  return (
    <div
      className="flex flex-col items-center gap-3"
      role="img"
      aria-label={`${label}: ${score} из 100, оценка ${grade}`}
    >
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke="var(--color-border)"
            strokeWidth={stroke}
            fill="none"
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={offset}
            fill="none"
            style={{ transition: "stroke-dashoffset 800ms ease" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <div className="text-5xl font-bold tabular-nums" style={{ color }}>
            {score}
          </div>
          <div className="text-sm text-muted-foreground mt-1">из 100</div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground uppercase tracking-wide">{label}</span>
        <span
          className="inline-flex items-center justify-center rounded-md px-2 py-0.5 text-sm font-bold text-white"
          style={{ backgroundColor: color }}
        >
          {grade}
        </span>
      </div>
    </div>
  );
}
