import type { Report } from "@/types/report";
import { isReport } from "@/lib/validate";

const KEY = "siteready:report";

export function saveReport(r: Report) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(r));
  } catch {
    /* ignore */
  }
}

export function loadStoredReport(): Report | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return isReport(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function clearReport() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
