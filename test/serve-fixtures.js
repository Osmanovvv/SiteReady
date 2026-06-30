"use strict";

// Local fixture server for engine tests (PLAN §10). Serves test/fixtures plus a
// few special routes: redirect chain/loop, slow (timeout), gzip, windows-1251,
// and an SSRF-bait redirect to the cloud-metadata IP.

const http = require("http");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const DIR = path.join(__dirname, "fixtures");

// "Привет" encoded in windows-1251 (constructed directly — Node has no 1251 encoder).
const CYR_PRIVET = Buffer.from([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2]);
const CP1251_PAGE = Buffer.concat([
  Buffer.from('<html><head><title>', "latin1"),
  CYR_PRIVET,
  Buffer.from("</title></head><body><h1>", "latin1"),
  CYR_PRIVET,
  Buffer.from("</h1></body></html>", "latin1"),
]);

function createServer() {
  return http.createServer((req, res) => {
    let p;
    try { p = new URL(req.url, "http://127.0.0.1").pathname; } catch (_) { p = req.url; }

    if (p === "/redirect-chain") { res.writeHead(302, { Location: "/redirect-2" }); return res.end(); }
    if (p === "/redirect-2") { res.writeHead(302, { Location: "/index.html" }); return res.end(); }
    if (p === "/redirect-loop") { res.writeHead(302, { Location: "/redirect-loop" }); return res.end(); }
    if (p === "/slow") {
      const t = setTimeout(() => {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end("<html><body>slow</body></html>");
      }, 3000);
      req.on("close", () => clearTimeout(t));
      return;
    }
    if (p === "/gzip") {
      const body = Buffer.from(
        "<html><head><title>GZ</title></head><body><h1>Сжатая страница</h1></body></html>",
        "utf8"
      );
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Encoding": "gzip" });
      return res.end(zlib.gzipSync(body));
    }
    if (p === "/cp1251") {
      res.writeHead(200, { "Content-Type": "text/html; charset=windows-1251" });
      return res.end(CP1251_PAGE);
    }
    if (p === "/private-redirect") {
      res.writeHead(302, { Location: "http://169.254.169.254/latest/meta-data/" });
      return res.end();
    }
    if (p === "/big") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      return res.end(Buffer.alloc(50000, 120)); // 50 KB of 'x' — for the decompression-cap test
    }
    if (p === "/deflate") {
      const body = Buffer.from("<html><head><title>DEF страница</title></head><body><h1>Zlib deflate работает</h1></body></html>", "utf8");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Encoding": "deflate" });
      return res.end(zlib.deflateSync(body));
    }
    if (p === "/raw-deflate") {
      const body = Buffer.from("<html><head><title>RAW страница</title></head><body><h1>Raw deflate работает</h1></body></html>", "utf8");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Encoding": "deflate" });
      return res.end(zlib.deflateRawSync(body)); // RFC1951 raw — no zlib header
    }
    if (p === "/brotli") {
      const body = Buffer.from("<html><head><title>BR страница</title></head><body><h1>Brotli работает</h1></body></html>", "utf8");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Encoding": "br" });
      return res.end(zlib.brotliCompressSync(body));
    }
    if (p === "/drip") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.write("<html><body>");
      let k = 0;
      const t = setInterval(() => {
        if (k++ > 60) { clearInterval(t); try { res.end("</body></html>"); } catch (_) { /* noop */ } }
        else { try { res.write("x"); } catch (_) { clearInterval(t); } }
      }, 200);
      req.on("close", () => clearInterval(t));
      return;
    }
    if (p === "/dead") {
      res.writeHead(500, { "Content-Type": "text/html" });
      return res.end("<html><body>500 Internal Server Error</body></html>");
    }
    if (p === "/forbidden") {
      res.writeHead(403, { "Content-Type": "text/html" });
      return res.end("<html><body>403 Forbidden to bots</body></html>");
    }
    if (p === "/ext-test") {
      // Links to "localhost" (a different hostname than the 127.0.0.1 start host)
      // are EXTERNAL for the crawler — used to exercise external-link checking.
      const lp = req.socket.localPort;
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(
        '<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Страница с внешними ссылками для проверки</title></head><body><h1>Внешние ссылки</h1>' +
          `<a href="http://localhost:${lp}/missing-page">битая внешняя (404)</a>` +
          `<a href="http://localhost:${lp}/forbidden">заблокирована для ботов (403)</a>` +
          `<a href="http://localhost:${lp}/about.html">рабочая внешняя (200)</a>` +
          "</body></html>"
      );
    }
    if (p === "/multibroken") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end('<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Страница с повторной битой ссылкой в навигации</title></head><body><h1>Заголовок</h1><nav><a href="/missing-page">сюда</a><a href="/missing-page">и сюда</a><a href="/missing-page">и ещё раз</a></nav></body></html>');
    }
    if (p === "/hub") {
      let links = "";
      for (let i = 1; i <= 30; i += 1) links += `<a href="/n${i}">страница ${i}</a>`;
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Хаб со многими ссылками</title></head><body><h1>Хаб</h1>${links}</body></html>`);
    }
    if (/^\/n\d+$/.test(p)) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Узел ${p}</title></head><body><h1>Узел ${p}</h1></body></html>`);
    }

    const file = p === "/" ? "/index.html" : p;
    const fp = path.normalize(path.join(DIR, file));
    if (!fp.startsWith(DIR)) { res.writeHead(403); return res.end("forbidden"); }
    fs.readFile(fp, (err, data) => {
      if (err) {
        res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
        return res.end("<html><body><h1>404 Не найдено</h1></body></html>");
      }
      const ext = path.extname(fp).toLowerCase();
      const type =
        ext === ".html" ? "text/html; charset=utf-8"
          : ext === ".css" ? "text/css"
          : ext === ".js" ? "application/javascript"
          : "application/octet-stream";
      res.writeHead(200, { "Content-Type": type });
      res.end(data);
    });
  });
}

module.exports = { createServer };
