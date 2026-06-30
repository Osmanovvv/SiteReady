import { formatBytes, gradeColor, gradeFromScore, severityColor, severityLabel, statusColor } from "@/lib/format";
import type { PageRow } from "@/types/report";

export function PagesTable({ pages }: { pages: PageRow[] }) {
  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <div className="p-4 border-b">
        <h3 className="text-base font-semibold">Страницы ({pages.length})</h3>
      </div>
      {/* `relative` makes this the containing block for the sr-only spans inside the
          table; otherwise they position against <html> at the wide table's
          coordinates and leak ~13px of horizontal page scroll on mobile. */}
      <div className="relative overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="text-left font-medium px-4 py-2.5">URL</th>
              <th className="text-left font-medium px-3 py-2.5">Статус</th>
              <th className="text-left font-medium px-3 py-2.5">Балл</th>
              <th className="text-left font-medium px-3 py-2.5">Проблемы</th>
              <th className="text-right font-medium px-3 py-2.5">TTFB</th>
              <th className="text-right font-medium px-4 py-2.5">Размер</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {pages.map((p) => {
              const sc = statusColor(p.status);
              const gc = gradeColor(gradeFromScore(p.score));
              return (
                <tr key={p.url} className="hover:bg-muted/30">
                  <td className="px-4 py-2.5">
                    <div className="font-mono text-xs truncate max-w-[160px] sm:max-w-[280px]" title={p.url}>
                      {p.url}
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <span
                      className="inline-flex items-center rounded-md px-1.5 py-0.5 text-xs font-semibold text-white"
                      style={{ backgroundColor: sc }}
                    >
                      {p.status}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="font-semibold tabular-nums" style={{ color: gc }}>
                      {p.score}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2 text-xs">
                      {(["critical", "warning", "info"] as const).map((sev) => {
                        const n = p.issueCounts[sev];
                        if (!n) return null;
                        return (
                          <span
                            key={sev}
                            className="inline-flex items-center gap-1 tabular-nums"
                            title={severityLabel(sev)}
                          >
                            <span
                              aria-hidden="true"
                              className="w-1.5 h-1.5 rounded-full"
                              style={{ backgroundColor: severityColor(sev) }}
                            />
                            <span className="sr-only">{severityLabel(sev)}: </span>
                            {n}
                          </span>
                        );
                      })}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                    {p.ttfbMs} мс
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                    {formatBytes(p.bytes)}
                  </td>
                </tr>
              );
            })}
            {pages.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-muted-foreground">
                  Страницы не просканированы.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
