import type { Grade, Severity } from "@/types/report";

export function formatBytes(b: number): string {
  if (!b) return "0 Б";
  const units = ["Б", "КБ", "МБ", "ГБ"];
  let i = 0;
  let n = b;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} мс`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)} с`;
  return `${Math.floor(s / 60)} мин ${Math.round(s % 60)} с`;
}

export function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("ru-RU", {
      day: "2-digit",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function severityLabel(s: Severity): string {
  return s === "critical" ? "Критично" : s === "warning" ? "Важно" : "Инфо";
}

export function severityColor(s: Severity): string {
  return s === "critical"
    ? "var(--color-sev-critical)"
    : s === "warning"
    ? "var(--color-sev-warning)"
    : "var(--color-sev-info)";
}

export function gradeColor(g: Grade): string {
  if (g === "A" || g === "B") return "var(--color-grade-good)";
  if (g === "C") return "var(--color-grade-ok)";
  if (g === "D") return "var(--color-grade-warn)";
  return "var(--color-grade-bad)";
}

/** Single source of truth for score→grade, matching CONTRACT.md bands. */
export function gradeFromScore(score: number): Grade {
  if (score >= 90) return "A";
  if (score >= 75) return "B";
  if (score >= 60) return "C";
  if (score >= 40) return "D";
  return "F";
}

function pageWord(n: number): string {
  const mod100 = Math.abs(n) % 100;
  const mod10 = n % 10;
  if (mod10 === 1 && mod100 !== 11) return "странице";
  return "страницах";
}

/**
 * Label for the "затронуто" number, honouring issue.mode (CONTRACT §3):
 * prevalence → number of pages; count → number of discrete defects.
 */
export function affectedLabel(mode: "prevalence" | "count", count: number): string {
  return mode === "count" ? `${count} шт` : `на ${count} ${pageWord(count)}`;
}

export function statusColor(status: number): string {
  if (status >= 200 && status < 300) return "var(--color-grade-good)";
  if (status >= 300 && status < 400) return "var(--color-sev-info)";
  return "var(--color-grade-bad)";
}

export function categoryRu(key: string): string {
  const map: Record<string, string> = {
    seo: "SEO",
    tech: "Тех/QA",
    performance: "Производительность",
    accessibility: "Доступность",
    responsive: "Адаптивность",
  };
  return map[key] ?? key;
}

export function confidenceLabel(c: string): string {
  return c === "estimated" ? "оценочно" : c === "static" ? "статически" : "";
}
