"use strict";

// Terminal entry point (PLAN §3). Runs a full audit and prints the CONTRACT report.

const { audit } = require("./src/audit");

async function main() {
  const args = process.argv.slice(2);
  const url = args.find((a) => !a.startsWith("--"));
  if (!url) {
    console.error("Usage: node cli.js <url> [--deep] [--lighthouse] [--external] [--allow-private] [--max=N] [--summary]");
    process.exit(1);
  }
  const allowPrivate = args.includes("--allow-private");
  const checkExternal = args.includes("--external");
  const deep = args.includes("--deep");
  const lighthouse = args.includes("--lighthouse");
  const summary = args.includes("--summary");
  const maxArg = args.find((a) => a.startsWith("--max="));
  const maxPages = maxArg ? Number(maxArg.slice(6)) || 50 : 50;

  const report = await audit(url, {
    allowPrivate,
    checkExternal,
    deep,
    lighthouse,
    maxPages,
    onProgress: (p) => {
      const line = `[${p.phase}] ${p.pagesCrawled}/${p.pagesDiscovered} ${p.currentUrl || ""}`;
      process.stderr.write("\r" + line.slice(0, 92).padEnd(94));
    },
  });
  process.stderr.write("\n");

  if (summary) {
    const s = report.score;
    console.log(`\n${report.meta.finalUrl}`);
    console.log(`Общий балл: ${s.overall} (${s.grade})  ·  страниц: ${report.meta.pagesCrawled}/${report.meta.pagesDiscovered}${report.meta.mode === "deep" ? "  ·  deep" : ""}${report.meta.flags.spa ? "  ·  SPA" : ""}`);
    for (const c of s.categories) {
      console.log(`  ${c.label.padEnd(20)} ${String(c.score).padStart(3)} (${c.grade})  крит ${c.issueCounts.critical} · важно ${c.issueCounts.warning} · инфо ${c.issueCounts.info}`);
    }
    console.log(`\nПроблемы (${report.issues.length}):`);
    for (const i of report.issues) {
      console.log(`  [${i.severity[0].toUpperCase()}] ${i.title} — ${i.affectedCount} (−${i.penalty}) ${i.scored ? "" : "[info]"}`);
    }
  } else {
    console.log(JSON.stringify(report, null, 2));
  }
}

main().catch((e) => {
  console.error("Error:", e.code || "", e.message);
  process.exit(1);
});
