"use strict";

// Egress / SSRF guard (PLAN §7, CONTRACT §7).
// Binding the server to loopback limits INGRESS only. This guard limits EGRESS:
// it validates the resolved/literal destination IP of every request — including
// each redirect hop — and pins DNS-resolved connections to the verified IP.
//
// IPs are classified by NUMERIC range, not string patterns, so encoding variants
// (bracketed IPv6, hex-compressed IPv4-mapped, NAT64, decimal/hex IPv4) cannot
// slip past. Cloud-metadata is blocked ALWAYS, even under allowPrivate.

const dns = require("dns");
const net = require("net");

/* ---------------------------------- IPv4 ---------------------------------- */

function ipv4ToInt(ip) {
  const parts = String(ip).split(".");
  if (parts.length !== 4) return null;
  let v = 0;
  for (const p of parts) {
    if (p === "" || /[^0-9]/.test(p)) return null;
    const n = Number(p);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    v = (v << 8) | n;
  }
  return v >>> 0;
}

function inRange(ipInt, baseInt, maskBits) {
  if (maskBits === 0) return true;
  const mask = (~((1 << (32 - maskBits)) - 1)) >>> 0;
  return (ipInt & mask) === (baseInt & mask);
}

const V4_BLOCKS = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // CGNAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local (incl. cloud metadata)
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
];

function isPrivateIPv4(ip) {
  const v = ipv4ToInt(ip);
  if (v === null) return false;
  for (const [base, bits] of V4_BLOCKS) {
    if (inRange(v, ipv4ToInt(base), bits)) return true;
  }
  return false;
}

const META_V4 = ipv4ToInt("169.254.169.254"); // cloud metadata: blocked always

function classifyIPv4(ip) {
  const v = ipv4ToInt(ip);
  const metadata = v !== null && v === META_V4;
  return { private: metadata || isPrivateIPv4(ip), metadata };
}

/* ---------------------------------- IPv6 ---------------------------------- */

// Parse any IPv6 spelling (compressed, mixed-case, IPv4-tail, zone id) into 16
// canonical bytes, or null if not valid IPv6.
function parseIPv6(input) {
  let s = String(input).split("%")[0].toLowerCase();

  // Convert a trailing dotted-IPv4 (mapped/compat/NAT64 forms) into two hextets.
  if (s.indexOf(".") !== -1) {
    const lastColon = s.lastIndexOf(":");
    if (lastColon === -1) return null;
    const v4 = s.slice(lastColon + 1);
    const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(v4);
    if (!m) return null;
    const b = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
    if (b.some((x) => x > 255)) return null;
    s = s.slice(0, lastColon + 1) + ((b[0] << 8) | b[1]).toString(16) + ":" + ((b[2] << 8) | b[3]).toString(16);
  }

  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] === "" ? [] : halves[0].split(":");
  let hextets;
  if (halves.length === 1) {
    hextets = head;
    if (hextets.length !== 8) return null;
  } else {
    const tail = halves[1] === "" ? [] : halves[1].split(":");
    const fill = 8 - head.length - tail.length;
    if (fill < 1) return null; // "::" must stand for at least one zero group
    hextets = head.concat(new Array(fill).fill("0"), tail);
  }

  const bytes = new Uint8Array(16);
  for (let i = 0; i < 8; i += 1) {
    const h = hextets[i];
    if (!/^[0-9a-f]{1,4}$/.test(h)) return null;
    const v = parseInt(h, 16);
    bytes[i * 2] = v >> 8;
    bytes[i * 2 + 1] = v & 0xff;
  }
  return bytes;
}

function classifyIPv6(bytes) {
  const zeros = (from, to) => {
    for (let i = from; i < to; i += 1) if (bytes[i] !== 0) return false;
    return true;
  };
  const embeddedV4 = () => `${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`;

  if (zeros(0, 16)) return { private: true, metadata: false }; // ::
  if (zeros(0, 15) && bytes[15] === 1) return { private: true, metadata: false }; // ::1 loopback

  // IPv4-mapped ::ffff:0:0/96 and IPv4-compatible ::/96 — delegate to the embedded v4.
  if (zeros(0, 10) && bytes[10] === 0xff && bytes[11] === 0xff) return classifyIPv4(embeddedV4());
  if (zeros(0, 12)) return classifyIPv4(embeddedV4());

  // NAT64 64:ff9b::/96 — delegate to the embedded v4.
  if (bytes[0] === 0x00 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b && zeros(4, 12)) {
    return classifyIPv4(embeddedV4());
  }

  // ULA fc00::/7 (incl. AWS IPv6 metadata fd00:ec2::254).
  if ((bytes[0] & 0xfe) === 0xfc) {
    const awsMeta = bytes[0] === 0xfd && bytes[1] === 0x00 && bytes[2] === 0x0e && bytes[3] === 0xc2 && zeros(4, 14) && bytes[14] === 0x02 && bytes[15] === 0x54;
    return { private: true, metadata: awsMeta };
  }
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return { private: true, metadata: false }; // fe80::/10 link-local
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0xc0) return { private: true, metadata: false }; // fec0::/10 site-local (deprecated)

  return { private: false, metadata: false };
}

/* -------------------------------- classify -------------------------------- */

function classifyAddress(ip, family) {
  const s = String(ip);
  const isV6 = family === 6 || s.includes(":");
  if (!isV6) return classifyIPv4(s);
  const bytes = parseIPv6(s);
  if (!bytes) return { private: true, metadata: false }; // unparseable v6 → fail safe (block)
  return classifyIPv6(bytes);
}

function isAddressBlocked(ip, family, allowPrivate) {
  const c = classifyAddress(ip, family);
  if (c.metadata) return true; // always
  if (c.private && !allowPrivate) return true;
  return false;
}

/* --------------------------------- guards --------------------------------- */

// http(s).request lookup hook: resolve once, validate, connect to the verified IP
// (no re-resolution → no TOCTOU / DNS-rebinding window).
function makeLookup(allowPrivate) {
  return function lookup(hostname, options, callback) {
    const cb = typeof options === "function" ? options : callback;
    const opts = options && typeof options === "object" ? options : {};
    if (opts.all) {
      dns.lookup(hostname, { ...opts, all: true }, (err, addresses) => {
        if (err) return cb(err);
        for (const a of addresses) {
          if (isAddressBlocked(a.address, a.family, allowPrivate)) return cb(blockedError(a.address, hostname));
        }
        cb(null, addresses);
      });
      return;
    }
    dns.lookup(hostname, { family: opts.family || 0 }, (err, address, family) => {
      if (err) return cb(err);
      if (isAddressBlocked(address, family, allowPrivate)) return cb(blockedError(address, hostname));
      cb(null, address, family);
    });
  };
}

function blockedError(address, hostname) {
  const e = new Error(`Blocked private/link-local address ${address} for host ${hostname}`);
  e.code = "SSRF_BLOCKED";
  return e;
}

function assertSchemeAllowed(urlObj) {
  if (urlObj.protocol !== "http:" && urlObj.protocol !== "https:") {
    const e = new Error(`Unsupported scheme: ${urlObj.protocol}`);
    e.code = "BAD_URL";
    throw e;
  }
}

// Pre-connection check. Node skips the lookup hook for literal-IP hosts, so we
// validate those here. WHATWG URL keeps brackets on IPv6 hostnames — strip them
// before classification. Call for the start URL AND every redirect hop.
function assertHostAllowed(urlObj, allowPrivate) {
  assertSchemeAllowed(urlObj);
  const host = urlObj.hostname.replace(/^\[/, "").replace(/\]$/, "");
  const fam = net.isIP(host);
  if (fam && isAddressBlocked(host, fam, allowPrivate)) {
    const e = new Error(`Blocked address ${host}`);
    e.code = "SSRF_BLOCKED";
    throw e;
  }
}

module.exports = {
  makeLookup,
  isAddressBlocked,
  classifyAddress,
  isPrivateIPv4,
  parseIPv6,
  assertSchemeAllowed,
  assertHostAllowed,
  ipv4ToInt,
};
