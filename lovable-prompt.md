# Промпт для Lovable — фронтенд SiteReady

Скопируй текст ниже целиком в Lovable как задание. Дополнительно прикрепи/вставь
`sample-report.json` как мок-данные. Не давай Lovable придумывать свою структуру данных —
он должен использовать ровно эту.

---

## ВСТАВЛЯТЬ В LOVABLE ↓

Построй веб-приложение **SiteReady** — отчёт аудита сайта «под ключ». Весь интерфейс на
русском, современный, чистый, минималистичный. Стек: React + Vite + TypeScript + Tailwind +
shadcn/ui. Светлая тема по умолчанию (тёмная — опционально).

ВАЖНО: приложение рендерит данные строго по приведённой ниже структуре (это реальный формат
бэкенда). Не меняй имена полей и не придумывай свою схему. Для разработки используй
приложенный `sample-report.json` как мок.

### Модель данных (TypeScript)
```ts
type Severity = "critical" | "warning" | "info";
type Grade = "A" | "B" | "C" | "D" | "F";
type Confidence = "full" | "static" | "estimated";

interface Report {
  meta: {
    startUrl: string; finalUrl: string; generatedAt: string;
    durationMs: number; pagesCrawled: number; pagesDiscovered: number;
    sampled: boolean; flags: { spa: boolean };
  };
  score: {
    overall: number; grade: Grade;
    categories: {
      key: "seo" | "tech" | "performance" | "accessibility" | "responsive";
      label: string; score: number; grade: Grade; weight: number;
      confidence: Confidence; confidenceNote: string;
      issueCounts: { critical: number; warning: number; info: number };
    }[];
  };
  issues: {
    id: string; category: string; severity: Severity;
    title: string; detail: string; fix: string;
    mode: "prevalence" | "count"; scored: boolean; penalty: number;
    affectedCount: number; affectedPages: string[]; sample: string[];
  }[];
  pages: {
    url: string; status: number; score: number;
    issueCounts: { critical: number; warning: number; info: number };
    ttfbMs: number; bytes: number; redirectChain: { url: string; status: number }[];
  }[];
}
```

### Экраны
1. **Старт.** Поле ввода URL + кнопка «Проверить». Доп. опции (сворачиваемые): лимит страниц
   (число, дефолт 50), переключатели «проверять внешние ссылки» и «разрешить локальные адреса».
2. **Прогресс.** Полоса прогресса, фазы (Обход → Проверка ссылок → Анализ → Готово), счётчик
   «Просканировано {pagesCrawled} из {pagesDiscovered}», текущий URL. Пока без бэкенда —
   анимируй на фейковом таймере, затем покажи результат из мока.
3. **Дашборд (Быстрый вид).**
   - Крупный общий балл `score.overall` + буквенная оценка `score.grade` (циферблат/кольцо).
   - Если `meta.sampled` — бейдж «выборка: {pagesCrawled} из {pagesDiscovered}».
   - Если `meta.flags.spa` — заметный баннер: «Сайт рендерится на клиенте — статический аудит ограничен».
   - 5 карточек категорий (`score.categories`): название, балл, мини-полоса, счётчики
     critical/warning/info. Если `confidence ≠ "full"` — маленький бейдж («оценочно» /
     «статически») с тултипом `confidenceNote`.
   - Список проблем (`issues`): фильтр по severity; каждая строка — иконка/цвет severity,
     `title`, бейдж категории, `affectedCount`; раскрытие показывает `detail`, список
     `affectedPages`, блок «Как починить» = `fix`, и `sample` если есть. Проблемы с
     `scored=false` помечай меткой «информативно».
   - Таблица страниц (`pages`): URL, статус (цвет по коду), балл, счётчики проблем, TTFB, размер.
4. **Клиентский отчёт.** Отдельный чистый «печатный» вид: шапка (место под лого/имя — заглушка,
   URL сайта `meta.finalUrl`, дата `meta.generatedAt`), краткое резюме (балл, оценка, сколько
   проблем по уровням), затем проблемы по приоритету (critical → warning → info) понятным
   языком с советами `fix`. Внизу — футер «Сделано в SiteReady».
   - Кнопка **«Скачать PDF»** = `window.print()` с аккуратными print-стилями.
   - Кнопка **«Скачать HTML»** = выгрузка текущего отчёта автономным .html (через Blob).
5. Переключатель вверху: «Быстрый вид» / «Клиентский отчёт».

### Цвета и статусы
- severity: critical — красный, warning — жёлтый/янтарный, info — синий.
- grade: A/B — зелёный, C — жёлтый, D — оранжевый, F — красный.
- статус страницы: 2xx — зелёный, 3xx — синий, 4xx/5xx — красный.

### Подготовка к интеграции (важно)
- Базовый URL API вынеси в переменную окружения `VITE_API_BASE` (по умолчанию пусто = мок).
- Заложи функцию загрузки отчёта: если `VITE_API_BASE` задан — подключайся к
  `${VITE_API_BASE}/api/audit/stream?url=...` через `EventSource` (события `meta`,
  `progress`, `done`, `error`); иначе используй мок `sample-report.json`.
- Не хардкодь данные внутри компонентов — всё из объекта `Report`.

## ВСТАВЛЯТЬ В LOVABLE ↑

---

## После сборки в Lovable
Экспортируй проект (кнопка экспорта / GitHub / zip) и пришли мне архив. Я:
1. проверю, что фронт читает формат из `CONTRACT.md`;
2. подключу его к Node-движку (живой SSE вместо мока);
3. настрою, чтобы Node отдавал собранный фронт + API — запуск одной командой.
