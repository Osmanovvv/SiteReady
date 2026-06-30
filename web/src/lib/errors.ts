// User-facing copy for CONTRACT §1 error codes. The frontend owns the wording by
// code; the server's `message` is only a fallback for codes we don't recognise.
// A transport drop (EventSource connection error, no payload) is its own case.

export const ERROR_TEXT: Record<string, string> = {
  BAD_URL: "Некорректный URL. Проверьте адрес (например, https://site.ru).",
  DNS_FAIL: "Сайт не найден по этому адресу (DNS). Проверьте домен.",
  PRIVATE_BLOCKED: "Локальный/приватный адрес. Включите «Разрешить локальные адреса», чтобы проверить.",
  SSRF_BLOCKED: "Адрес заблокирован egress-защитой (похоже на внутренний ресурс).",
  TIMEOUT: "Сайт не ответил вовремя. Попробуйте ещё раз.",
  UNREACHABLE: "Не удалось подключиться к сайту.",
};

export const TRANSPORT_ERROR = "Соединение прервано. Проверьте сеть и повторите.";

/**
 * Resolve the message shown to the user.
 * - known code  → canonical localized text
 * - unknown code → server `message` if any, else a neutral fallback
 * - no code (transport drop) → connection-lost text
 */
export function errorText(code?: string | null, serverMessage?: string | null): string {
  if (code && ERROR_TEXT[code]) return ERROR_TEXT[code];
  if (code) return (serverMessage && serverMessage.trim()) || "Не удалось выполнить аудит. Попробуйте ещё раз.";
  return TRANSPORT_ERROR;
}
