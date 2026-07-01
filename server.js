"use strict";

// Backend (PLAN §7, CONTRACT §1). Pure Node, zero deps.
// - Binds 127.0.0.1 ONLY (ingress closed; egress is guarded separately in net-guard).
// - GET /api/audit/stream → SSE: meta · progress · done · error (exact CONTRACT shape).
// - GET /* → the built frontend (web/dist) with SPA fallback, or an info placeholder.
// - In-memory, one audit per request; a client disconnect stops the crawl.

const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");
const { audit } = require("./src/audit");
const { assertHostAllowed } = require("./src/net-guard");
const { isDeepAvailable, DEEP_MAX_PAGES } = require("./src/deep");
const { saveAudit, listHistory, getAudit, diffReports } = require("./src/store");

function sendJson(res, data, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(data));
}
async function handleDiff(res, aId, bId) {
  try {
    const [a, b] = await Promise.all([getAudit(aId), getAudit(bId)]);
    if (!a || !b) return sendJson(res, { error: "not found" }, 404);
    const [older, newer] = a.meta.generatedAt <= b.meta.generatedAt ? [a, b] : [b, a];
    sendJson(res, diffReports(older, newer));
  } catch (_) {
    sendJson(res, { error: "error" }, 500);
  }
}

const HOST = "127.0.0.1";
const DEFAULT_PORT = Number(process.env.PORT) || 3000;
const WEB_DIST = path.join(__dirname, "web", "dist");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".map": "application/json",
  ".txt": "text/plain; charset=utf-8",
};

function clampInt(v, def, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, Math.floor(n)));
}
function truthy(v) {
  return v === "1" || v === "true";
}

function normalizeInput(raw) {
  const t = String(raw || "").trim();
  if (!t) return null;
  const withScheme = /^https?:\/\//i.test(t) ? t : "https://" + t;
  try { return new URL(withScheme); } catch (_) { return null; }
}

function handleAudit(req, res, params) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  const send = (event, data) => {
    try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch (_) { /* client gone */ }
  };

  const urlObj = normalizeInput(params.get("url"));
  if (!urlObj) { send("error", { code: "BAD_URL", message: "Некорректный URL" }); return res.end(); }

  const allowPrivate = truthy(params.get("allowLocal"));
  const checkExternal = truthy(params.get("checkExternal"));
  const deep = truthy(params.get("deep"));
  const maxPages = clampInt(params.get("limit"), deep ? 12 : 50, 1, deep ? DEEP_MAX_PAGES : 500);

  if (deep && !isDeepAvailable()) {
    send("error", {
      code: "DEEP_UNAVAILABLE",
      message: "Глубокий режим недоступен: на сервере не установлен браузер (npm i playwright && npx playwright install chromium).",
    });
    return res.end();
  }

  // Up-front, clear error for a literal private/blocked host (hostnames are
  // still validated at resolve time inside the engine).
  try {
    assertHostAllowed(urlObj, allowPrivate);
  } catch (_) {
    send("error", {
      code: allowPrivate ? "SSRF_BLOCKED" : "PRIVATE_BLOCKED",
      message: "Адрес заблокирован egress-защитой. Для аудита локального адреса включите «разрешить локальные адреса».",
    });
    return res.end();
  }

  let aborted = false;
  req.on("close", () => { aborted = true; });

  send("meta", {
    startUrl: params.get("url"),
    normalizedUrl: urlObj.href,
    startedAt: new Date().toISOString(),
    pagesDiscovered: 0,
  });

  audit(urlObj.href, {
    maxPages,
    allowPrivate,
    checkExternal,
    deep,
    onProgress: (p) => { if (!aborted) send("progress", p); },
    signal: () => aborted,
  })
    .then((report) => {
      if (aborted) return;
      send("done", report); // CONTRACT: the Report object itself, no wrapper
      res.end();
      saveAudit(report); // best-effort history persistence (PLAN-v2 §2)
    })
    .catch((e) => {
      if (aborted) return;
      send("error", { code: e.code || "UNREACHABLE", message: e.message || "Не удалось выполнить аудит" });
      res.end();
    });
}

function placeholder(res) {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(
    '<!doctype html><html lang="ru"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width, initial-scale=1"><title>SiteReady — движок</title>' +
      "<style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:640px;margin:12vh auto;padding:0 20px;color:#1b1b19;line-height:1.6}code{background:#efeee8;padding:2px 6px;border-radius:4px}</style></head>" +
      "<body><h1>SiteReady — движок запущен</h1><p>API готов. Собранный фронт (<code>web/dist</code>) подключается на Этапе 6.</p>" +
      "<p>SSE-аудит: <code>GET /api/audit/stream?url=example.com&amp;limit=20&amp;allowLocal=0</code></p></body></html>"
  );
}

function serveStatic(req, res, pathname) {
  let rel = pathname;
  try { rel = decodeURIComponent(pathname); } catch (_) { /* keep raw */ }
  if (rel === "/" || rel === "") rel = "/index.html";
  const fp = path.normalize(path.join(WEB_DIST, rel));
  if (fp !== WEB_DIST && !fp.startsWith(WEB_DIST + path.sep)) { res.writeHead(403); return res.end("Forbidden"); }
  fs.readFile(fp, (err, data) => {
    if (err) {
      // SPA fallback: unknown non-file routes serve index.html.
      fs.readFile(path.join(WEB_DIST, "index.html"), (e2, html) => {
        if (e2) return placeholder(res);
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
      });
      return;
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(fp).toLowerCase()] || "application/octet-stream" });
    res.end(data);
  });
}

function createServer() {
  const hasFrontend = fs.existsSync(path.join(WEB_DIST, "index.html"));
  return http.createServer((req, res) => {
    let u;
    try { u = new URL(req.url, "http://127.0.0.1"); } catch (_) { res.writeHead(400); return res.end("Bad request"); }

    if (req.method === "GET" && u.pathname === "/api/capabilities") {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      return res.end(JSON.stringify({ deep: isDeepAvailable() }));
    }
    if (req.method === "GET" && u.pathname === "/api/history") {
      return void listHistory(u.searchParams.get("url")).then((h) => sendJson(res, h)).catch(() => sendJson(res, [], 500));
    }
    if (req.method === "GET" && u.pathname === "/api/report") {
      return void getAudit(u.searchParams.get("id")).then((r) => (r ? sendJson(res, r) : sendJson(res, { error: "not found" }, 404))).catch(() => sendJson(res, { error: "error" }, 500));
    }
    if (req.method === "GET" && u.pathname === "/api/diff") {
      return void handleDiff(res, u.searchParams.get("a"), u.searchParams.get("b"));
    }
    if (req.method === "GET" && u.pathname === "/api/audit/stream") return handleAudit(req, res, u.searchParams);
    if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405); return res.end("Method not allowed"); }
    if (hasFrontend) return serveStatic(req, res, u.pathname);
    return placeholder(res);
  });
}

if (require.main === module) {
  const server = createServer();
  server.listen(DEFAULT_PORT, HOST, () => {
    console.log(`SiteReady engine → http://${HOST}:${DEFAULT_PORT}   (SSE: /api/audit/stream?url=…)`);
  });
}

module.exports = { createServer };
