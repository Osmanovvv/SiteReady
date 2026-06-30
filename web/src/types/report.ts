export type Severity = "critical" | "warning" | "info";
export type Grade = "A" | "B" | "C" | "D" | "F";
export type Confidence = "full" | "static" | "estimated";
export type CategoryKey = "seo" | "tech" | "performance" | "accessibility" | "responsive";

export interface IssueCounts {
  critical: number;
  warning: number;
  info: number;
}

export interface Category {
  key: CategoryKey;
  label: string;
  score: number;
  grade: Grade;
  weight: number;
  confidence: Confidence;
  confidenceNote: string;
  issueCounts: IssueCounts;
}

export interface Issue {
  id: string;
  category: CategoryKey;
  severity: Severity;
  title: string;
  detail: string;
  fix: string;
  mode: "prevalence" | "count";
  scored: boolean;
  penalty: number;
  affectedCount: number;
  affectedPages: string[];
  sample: string[];
}

export interface PageRow {
  url: string;
  status: number;
  score: number;
  issueCounts: IssueCounts;
  ttfbMs: number;
  bytes: number;
  redirectChain: { url: string; status: number }[];
}

export interface Report {
  meta: {
    startUrl: string;
    finalUrl: string;
    generatedAt: string;
    durationMs: number;
    pagesCrawled: number;
    pagesDiscovered: number;
    sampled: boolean;
    flags: { spa: boolean };
  };
  score: {
    overall: number;
    grade: Grade;
    categories: Category[];
  };
  issues: Issue[];
  pages: PageRow[];
}
