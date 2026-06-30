import { gradeColor, severityColor, severityLabel, confidenceLabel } from "@/lib/format";
import type { Category } from "@/types/report";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Info } from "lucide-react";

export function CategoryCard({ c }: { c: Category }) {
  const color = gradeColor(c.grade);
  return (
    <div className="rounded-xl border bg-card p-5 flex flex-col gap-3 min-w-0">
      {/* Label gets its own row; the score and the confidence badge share the next
          row and may wrap — so a long category name + badge never spill the card. */}
      <div className="min-w-0">
        <div className="text-sm text-muted-foreground truncate" title={c.label}>
          {c.label}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 mt-1">
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold tabular-nums" style={{ color }}>
              {c.score}
            </span>
            <span
              className="inline-flex items-center justify-center rounded-md px-1.5 text-xs font-bold text-white"
              style={{ backgroundColor: color }}
            >
              {c.grade}
            </span>
          </div>
          {c.confidence !== "full" && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground cursor-help">
                    <Info aria-hidden="true" className="w-3 h-3 shrink-0" />
                    {confidenceLabel(c.confidence)}
                  </span>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <p className="text-xs">{c.confidenceNote || "Метрика не входит в итоговый балл."}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
      </div>

      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full rounded-full"
          style={{ width: `${c.score}%`, backgroundColor: color, transition: "width 600ms ease" }}
        />
      </div>

      <div className="flex items-center gap-3 text-xs">
        {(["critical", "warning", "info"] as const).map((sev) => {
          const n = c.issueCounts[sev];
          if (!n) return null;
          return (
            <span key={sev} className="inline-flex items-center gap-1" title={severityLabel(sev)}>
              <span
                aria-hidden="true"
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: severityColor(sev) }}
              />
              <span className="sr-only">{severityLabel(sev)}: </span>
              <span className="tabular-nums font-medium">{n}</span>
            </span>
          );
        })}
        <span className="ml-auto text-muted-foreground">вес {Math.round(c.weight * 100)}%</span>
      </div>
    </div>
  );
}
