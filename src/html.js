"use strict";

// Forgiving HTML tokenizer + page-model builder (PLAN §5.3).
// A small finite-state scanner — NOT a regex over the whole document — so that
// `<` inside scripts/comments/attributes never produces phantom tags. Broken
// markup degrades instead of throwing. For an auditor a false finding is worse
// than a missed one, so the parser must not invent structure.

const RAWTEXT = new Set(["script", "style", "textarea", "title"]);

function isLetter(ch) {
  const c = ch.charCodeAt(0);
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
}
function isNameChar(ch) {
  const c = ch.charCodeAt(0);
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || ch === ":" || ch === "-" || ch === "_";
}
function isWs(ch) {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "\f";
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };
function decodeEntities(s) {
  if (s.indexOf("&") === -1) return s;
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, name) => {
    const lower = name.toLowerCase();
    if (lower[0] === "#") {
      const code = lower[1] === "x" ? parseInt(lower.slice(2), 16) : parseInt(lower.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return Object.prototype.hasOwnProperty.call(ENTITIES, lower) ? ENTITIES[lower] : m;
  });
}

Object.assign(ENTITIES, {
  mdash: "—", ndash: "–", hellip: "…", laquo: "«", raquo: "»", shy: "",
  copy: "©", reg: "®", trade: "™", deg: "°", times: "×", middot: "·",
  rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”",
});

// Block-level tags that implicitly close an open heading/anchor text capture, so
// an unclosed <h1>/<a> can't swallow the rest of the document.
const BLOCK = new Set([
  "address", "article", "aside", "blockquote", "details", "dialog", "dd", "div", "dl", "dt",
  "fieldset", "figcaption", "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6",
  "header", "hgroup", "hr", "li", "main", "nav", "ol", "p", "pre", "section", "table", "tbody",
  "td", "tr", "ul",
]);

function stripTags(s) {
  return s.replace(/<[^>]*>/g, " ");
}

function findRawClose(html, from, name) {
  const lower = html.toLowerCase();
  const needle = "</" + name;
  let idx = from;
  while (true) {
    const p = lower.indexOf(needle, idx);
    if (p === -1) return -1;
    const after = lower[p + needle.length];
    if (after === undefined || isWs(after) || after === ">" || after === "/") return p;
    idx = p + needle.length;
  }
}

function tokenize(html) {
  const tokens = [];
  const n = html.length;
  let i = 0;
  let text = "";
  const pushText = () => { if (text) { tokens.push({ type: "text", text }); text = ""; } };

  while (i < n) {
    const lt = html.indexOf("<", i);
    if (lt === -1) { text += html.slice(i); break; }
    text += html.slice(i, lt);
    i = lt;

    const c1 = html[i + 1];
    if (c1 === "!") {
      pushText();
      if (html[i + 2] === "-" && html[i + 3] === "-") {
        // HTML5 abrupt-close empty comments: <!--> and <!--->
        if (html[i + 4] === ">") { i += 5; continue; }
        if (html[i + 4] === "-" && html[i + 5] === ">") { i += 6; continue; }
        const end = html.indexOf("-->", i + 4);
        i = end === -1 ? n : end + 3;
      } else {
        const end = html.indexOf(">", i + 2);
        i = end === -1 ? n : end + 1;
      }
      continue;
    }
    if (c1 === "?") {
      pushText();
      const end = html.indexOf(">", i + 2);
      i = end === -1 ? n : end + 1;
      continue;
    }

    const isEnd = c1 === "/";
    let j = i + (isEnd ? 2 : 1);
    if (j >= n || !isLetter(html[j])) {
      // a stray '<' that isn't a tag — treat literally
      text += "<";
      i += 1;
      continue;
    }
    pushText();

    let name = "";
    while (j < n && isNameChar(html[j])) { name += html[j]; j += 1; }
    name = name.toLowerCase();

    if (isEnd) {
      const end = html.indexOf(">", j);
      i = end === -1 ? n : end + 1;
      tokens.push({ type: "end", name });
      continue;
    }

    const attrs = {};
    let selfClosing = false;
    while (j < n) {
      while (j < n && isWs(html[j])) j += 1;
      if (j >= n) break;
      if (html[j] === ">") { j += 1; break; }
      if (html[j] === "/") {
        if (html[j + 1] === ">") { selfClosing = true; j += 2; break; }
        j += 1;
        continue;
      }
      let an = "";
      while (j < n && !isWs(html[j]) && html[j] !== "=" && html[j] !== ">" && html[j] !== "/") {
        an += html[j];
        j += 1;
      }
      an = an.toLowerCase();
      while (j < n && isWs(html[j])) j += 1;
      let av = "";
      if (html[j] === "=") {
        j += 1;
        while (j < n && isWs(html[j])) j += 1;
        const q = html[j];
        if (q === '"' || q === "'") {
          j += 1;
          const end = html.indexOf(q, j);
          av = end === -1 ? html.slice(j) : html.slice(j, end);
          j = end === -1 ? n : end + 1;
        } else {
          while (j < n && !isWs(html[j]) && html[j] !== ">") { av += html[j]; j += 1; }
        }
      }
      if (an) attrs[an] = decodeEntities(av);
    }
    tokens.push({ type: "start", name, attrs, selfClosing });

    if (RAWTEXT.has(name) && !selfClosing) {
      const closeIdx = findRawClose(html, j, name);
      const raw = html.slice(j, closeIdx === -1 ? n : closeIdx);
      tokens.push({ type: "text", text: raw, raw: true });
      if (closeIdx === -1) {
        i = n;
      } else {
        const gt = html.indexOf(">", closeIdx);
        i = gt === -1 ? n : gt + 1;
        tokens.push({ type: "end", name });
      }
      continue;
    }
    i = j;
  }
  pushText();
  return tokens;
}

function collapseWs(s) {
  return s.replace(/\s+/g, " ").trim();
}

function parseHtml(html) {
  const tokens = tokenize(html);
  const page = {
    lang: null,
    title: null,
    base: null,
    charsetMeta: null,
    viewport: null,
    hasHtmlTag: false,
    metas: [],
    links: [],
    stylesheets: [],
    inlineStyles: [],
    headings: [],
    anchors: [],
    images: [],
    scripts: [],
    jsonLd: [],
    iframes: [],
    ids: [],
    idCounts: {},
    textLength: 0,
  };

  // Active text capture for a single leaf-ish element (title/heading/anchor/script/style).
  let cap = null;

  const flushCap = (c) => {
    if (c.kind === "title") page.title = collapseWs(decodeEntities(stripTags(c.buf)));
    else if (c.kind === "anchor") { c.ref.text = collapseWs(decodeEntities(c.buf)); page.textLength += c.ref.text.length; }
    else if (c.kind === "heading") { c.ref.text = collapseWs(decodeEntities(c.buf)); page.textLength += c.ref.text.length; }
    else if (c.kind === "script") {
      c.ref.inline = c.buf;
      if (c.ref.type === "application/ld+json") {
        try { page.jsonLd.push({ ok: true, data: JSON.parse(c.buf) }); }
        catch (e) { page.jsonLd.push({ ok: false, error: String(e && e.message) }); }
      }
    } else if (c.kind === "style") page.inlineStyles.push(c.buf);
  };

  for (const t of tokens) {
    if (t.type === "text") {
      if (cap) cap.buf += t.text;
      else if (!t.raw) page.textLength += collapseWs(t.text).length;
      continue;
    }

    if (t.type === "start") {
      const a = t.attrs || {};

      // An unclosed heading/anchor implicitly closes at the next block-level tag.
      if (cap && (cap.kind === "heading" || cap.kind === "anchor") && BLOCK.has(t.name)) {
        flushCap(cap);
        cap = null;
      }

      switch (t.name) {
        case "html":
          page.hasHtmlTag = true;
          if (a.lang) page.lang = a.lang;
          break;
        case "base":
          if (a.href) page.base = a.href;
          break;
        case "meta": {
          const m = {
            name: a.name ? a.name.toLowerCase() : null,
            property: a.property ? a.property.toLowerCase() : null,
            httpEquiv: a["http-equiv"] ? a["http-equiv"].toLowerCase() : null,
            charset: a.charset || null,
            content: a.content != null ? a.content : null,
          };
          page.metas.push(m);
          if (m.charset) page.charsetMeta = page.charsetMeta || m.charset.toLowerCase();
          if (m.httpEquiv === "content-type" && m.content) {
            const mm = /charset\s*=\s*["']?([\w-]+)/i.exec(m.content);
            if (mm) page.charsetMeta = page.charsetMeta || mm[1].toLowerCase();
          }
          if (m.name === "viewport") page.viewport = m.content;
          break;
        }
        case "link": {
          const rel = (a.rel || "").toLowerCase();
          page.links.push({ rel, href: a.href || null });
          if (rel.split(/\s+/).includes("stylesheet") && a.href) page.stylesheets.push(a.href);
          break;
        }
        case "title":
          if (!cap) cap = { kind: "title", tag: "title", buf: "" };
          break;
        case "a": {
          const anchor = { href: a.href || null, rel: a.rel || null, target: a.target || null, text: "" };
          page.anchors.push(anchor);
          if (!cap) cap = { kind: "anchor", tag: "a", ref: anchor, buf: "" };
          break;
        }
        case "h1": case "h2": case "h3": case "h4": case "h5": case "h6": {
          const h = { level: Number(t.name[1]), text: "" };
          page.headings.push(h);
          if (!cap) cap = { kind: "heading", tag: t.name, ref: h, buf: "" };
          break;
        }
        case "img":
          page.images.push({
            src: a.src || null,
            alt: "alt" in a ? a.alt : null,
            hasAlt: "alt" in a,
            hasWidth: "width" in a,
            hasHeight: "height" in a,
            loading: a.loading ? a.loading.toLowerCase() : null,
          });
          break;
        case "script": {
          const s = {
            src: a.src || null,
            type: (a.type || "").toLowerCase(),
            async: "async" in a,
            defer: "defer" in a,
            inline: "",
          };
          page.scripts.push(s);
          if (!s.src && !cap) cap = { kind: "script", tag: "script", ref: s, buf: "" };
          break;
        }
        case "style":
          if (!cap) cap = { kind: "style", tag: "style", buf: "" };
          break;
        case "iframe":
          page.iframes.push({ src: a.src || null });
          break;
        default:
          break;
      }

      if (a.id) {
        page.ids.push(a.id);
        page.idCounts[a.id] = (page.idCounts[a.id] || 0) + 1;
      }
    } else if (t.type === "end") {
      if (cap && cap.tag === t.name) { flushCap(cap); cap = null; }
    }
  }

  // Commit any capture left open by malformed/unclosed markup (forgiving).
  if (cap) { flushCap(cap); cap = null; }

  return page;
}

module.exports = { parseHtml, tokenize, decodeEntities };
