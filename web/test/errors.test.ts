import { test } from "node:test";
import assert from "node:assert/strict";
import { ERROR_TEXT, errorText, TRANSPORT_ERROR } from "../src/lib/errors.ts";

const CODES = ["BAD_URL", "DNS_FAIL", "PRIVATE_BLOCKED", "SSRF_BLOCKED", "TIMEOUT", "UNREACHABLE", "REDIRECT_LOOP", "DEEP_UNAVAILABLE"];

test("each CONTRACT error code maps to its own non-empty text", () => {
  for (const code of CODES) {
    assert.ok(ERROR_TEXT[code] && ERROR_TEXT[code].length > 5, `missing/short text for ${code}`);
    assert.strictEqual(errorText(code), ERROR_TEXT[code]);
  }
});

test("REDIRECT_LOOP copy names the redirect problem specifically", () => {
  assert.match(ERROR_TEXT.REDIRECT_LOOP, /редирект|переадрес/i);
});

test("PRIVATE_BLOCKED copy invites enabling local addresses", () => {
  assert.match(ERROR_TEXT.PRIVATE_BLOCKED, /локальн/i);
});

test("transport drop (no code) → connection-lost text, not a code message", () => {
  assert.strictEqual(errorText(null), TRANSPORT_ERROR);
  assert.strictEqual(errorText(undefined), TRANSPORT_ERROR);
});

test("unknown code → server message, then neutral fallback", () => {
  assert.strictEqual(errorText("WEIRD", "детали с сервера"), "детали с сервера");
  assert.match(errorText("WEIRD"), /не удалось/i);
});

test("known code ignores the raw server message (frontend owns the copy)", () => {
  assert.strictEqual(errorText("BAD_URL", "raw server text"), ERROR_TEXT.BAD_URL);
});
