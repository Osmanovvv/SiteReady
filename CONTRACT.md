# SiteReady — контракт API (фронт ↔ движок)

Это единый формат данных между фронтом (Lovable/React) и движком (Node).
Фронт строится против него на моковых данных (`sample-report.json`), движок отдаёт
ровно такой же JSON. Меняем только источник — переделок UI не будет.

---

## 1. Эндпоинт аудита (SSE-стрим)

```
GET {API_BASE}/api/audit/stream?url=<сайт>&limit=50&checkExternal=1&allowLocal=0
```

Ответ — поток Server-Sent Events. Типы событий:

| event      | data (JSON)                                                          | когда |
|------------|---------------------------------------------------------------------|-------|
| `meta`     | `{ startUrl, normalizedUrl, startedAt, pagesDiscovered }`            | сразу на старте |
| `progress` | `{ phase, pagesCrawled, pagesDiscovered, currentUrl }`              | по ходу обхода |
| `done`     | объект `Report` **напрямую**, без обёртки — полный отчёт (схема §3)  | в конце |
| `error`    | `{ code, message }`                                                  | при ошибке |

`phase` ∈ `"Обход"` · `"Проверка ссылок"` · `"Анализ"` · `"Готово"` — это готовые русские строки для UI; фронт сравнивает их буквально. `currentUrl` — текущая страница обхода (или `null`).

> Имена в событии `progress` (`pagesCrawled`/`pagesDiscovered`) совпадают с полями `report.meta`.
> Событие `meta` фиксирует **старт**: `normalizedUrl` — URL после нормализации (до редиректов),
> `startedAt` — момент старта. В `report.meta` им соответствуют `finalUrl` (после редиректов) и
> `generatedAt` (конец). Имена различаются намеренно — это разные моменты, не опечатка.

Коды ошибок (`error.code`): `BAD_URL`, `DNS_FAIL`, `PRIVATE_BLOCKED` (приватный адрес,
нужен `allowLocal=1`), `SSRF_BLOCKED`, `TIMEOUT`, `UNREACHABLE`, `DEEP_UNAVAILABLE`
(запрошен `deep`, но на сервере не установлен браузер).

> На этапе Lovable стрим можно не подключать — рисуем по `sample-report.json`.
> Прогресс-экран показываем на мок-таймере; реальный SSE подключим при интеграции.

---

## 2. Параметры запроса
- `url` — стартовый URL (обязателен).
- `limit` — лимит страниц обхода (по умолчанию 50, диапазон 1..500).
- `checkExternal` — `1/0`, проверять ли внешние ссылки (по умолчанию выкл.).
- `allowLocal` — `1/0`, разрешить приватные/localhost-адреса (для дев-аудита).
- `deep` — `1/0`, глубокий режим: рендер каждой страницы в реальном браузере (v2, §1).
  Точнее для SPA (React/Vue), но медленнее; меньший лимит страниц (≤25). Требует установленного
  Playwright на сервере — иначе `error.code = DEEP_UNAVAILABLE`.
  > **Egress в deep.** Запросы браузера (навигация, сабресурсы, WebSocket) к metadata/приватным
  > IP блокируются перехватом: metadata — всегда, приватные — при `allowLocal=0`; при
  > нескольких A-записях блок, если приватна хоть одна. Chromium резолвит DNS сам, поэтому
  > остаётся окно DNS-rebinding (сервер может подменить IP между нашей проверкой и коннектом
  > браузера) — это присуще браузерному рендеру; аудитируйте доверенные адреса.

---

## 3. Схема отчёта (объект `report`)

```jsonc
{
  "meta": {
    "startUrl": "https://example.ru",
    "finalUrl": "https://example.ru/",
    "generatedAt": "2026-06-29T10:00:00.000Z",
    "durationMs": 12840,
    "pagesCrawled": 50,
    "pagesDiscovered": 210,
    "sampled": true,                 // crawled < discovered → бейдж «выборка»
    "mode": "static",                // "static" | "deep" (v2) — бейдж «отрендерено браузером» при deep
    "flags": { "spa": false }        // true → баннер «статический аудит ограничен» (только в static)
  },

  "score": {
    "overall": 78,                   // 0..100
    "grade": "B",                    // A|B|C|D|F
    "categories": [
      {
        "key": "seo",               // seo|tech|performance|accessibility|responsive
        "label": "SEO",
        "score": 82,
        "grade": "B",
        "weight": 0.30,             // вклад в общий балл
        "confidence": "full",       // full | static | estimated
        "confidenceNote": "",       // напр. «контраст/клавиатура — в deep-режиме»
        "issueCounts": { "critical": 1, "warning": 3, "info": 5 }
      }
      // … всего 5 категорий
    ]
  },

  "issues": [
    {
      "id": "seo.title.missing",
      "category": "seo",
      "severity": "critical",        // critical|warning|info
      "title": "Отсутствует <title>",
      "detail": "На 2 страницах нет тега <title> или он пустой.",
      "fix": "Добавьте уникальный <title> 30–60 символов на каждую страницу.",
      "mode": "prevalence",          // prevalence|count (см. PLAN §6)
      "scored": true,                // false = информативно, в балл не идёт (напр. TTFB)
      "penalty": 6.0,                // снято баллов (для прозрачности)
      "affectedCount": 2,            // prevalence → число страниц; count → число дефектов (может быть > числа страниц)
      "affectedPages": ["/", "/about"], // страницы, ГДЕ дефект; обрезается до 20 (полное число — в affectedCount)
      "sample": []                   // опц. примеры нарушающих значений (URL/текст), не страницы
    }
  ],

  "pages": [
    {
      "url": "/",
      "status": 200,
      "score": 80,
      "issueCounts": { "critical": 0, "warning": 2, "info": 1 },
      "ttfbMs": 180,                 // информативно
      "bytes": 234567,
      "redirectChain": []
    }
  ]
}
```

### Перечисления
- `category.key`: `seo`, `tech`, `performance`, `accessibility`, `responsive`.
- `severity`: `critical` (🔴), `warning` (🟡), `info` (🔵).
- `confidence`: `full` (надёжно), `static` (статический срез — a11y), `estimated` (оценочно — перф).
- `grade`: `A`≥90, `B`≥75, `C`≥60, `D`≥40, `F`<40.

### Инварианты и семантика полей (фронт ↔ движок)
- **`issues[]` — полный список.** Движок отдаёт каждую найденную проблему отдельным объектом;
  `score.categories[].issueCounts` равны подсчёту из `issues[]` по категории и severity. Источники
  сходятся — фронт может доверять любому.
- **`affectedCount` — два смысла по `mode`:** `prevalence` → число *страниц* с проблемой
  (из `meta.pagesCrawled`); `count` → число *дефектов* (битых ссылок, ресурсов и т.п.), может быть
  больше числа страниц. Подпись: prevalence → «на N страницах», count → «N шт».
- **`affectedPages` — страницы, где живёт дефект** (не цели ссылок и не значения). Список
  обрезается до 20; полное число — в `affectedCount` (фронт показывает «и ещё N»).
- **`sample` — примеры нарушающих значений** (URL ресурса, текст дубля, путь тяжёлой картинки), не страницы.
- **`meta` (стрим) vs `report.meta` — разные моменты:** `normalizedUrl`/`startedAt` (старт, до
  редиректов) ↔ `finalUrl`/`generatedAt` (конец). Имена различаются намеренно.
- **Ключи с префиксом `_` — служебные**, фронт их игнорирует (в `sample-report.json` есть
  `_comment` с пометкой «иллюстративно»).

---

## 4. Что фронт должен уметь показать
1. **Ввод**: URL + опции (limit, checkExternal, allowLocal).
2. **Прогресс**: фазы + «просканировано crawled из discovered» + текущий URL.
3. **Дашборд**: общий балл/грейд; бейдж «выборка» если `meta.sampled`; баннер SPA если `flags.spa`;
   5 карточек категорий (балл + бейдж `confidence` + счётчики проблем); список проблем
   (фильтр по severity, раскрытие `affectedPages`, текст `fix`); таблица `pages`.
4. **Клиентский отчёт**: чистая печатная версия (лого/имя, URL, дата, резюме, проблемы по
   приоритету), кнопки «Скачать PDF» (печать) и «Скачать HTML».
5. Переключатель «Быстрый вид» / «Клиентский отчёт». Весь UI на русском.

---

## 5. Интеграция (после Lovable)
1. Базовый URL API — через переменную окружения (`VITE_API_BASE`), чтобы переключать мок ↔ Node.
2. Прогресс — через `EventSource` на `/api/audit/stream`.
3. Финал — рендер из `report` (event `done`).
4. Node отдаёт собранный бандл фронта как статику + сам API → запуск одной командой.
