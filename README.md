Vite Agent Bridge — план развития

## Контекст и ограничения

Канал связи агента с браузером — **HMR WebSocket** существующего Vite-плагина:

- Браузерный код шлёт логи/результаты на dev-сервер через `import.meta.hot.send` (`dev-log`, `dev-exec-result`).
- Агент дёргает HTTP-эндпоинты dev-сервера (`/__dev_logs`, `/__dev_exec`) для чтения буфера и запуска JS в браузере.
- Сам сервер отдаёт команды браузеру через `server.ws.send({type: 'custom', event: 'dev-exec', …})`.

Канал уже двусторонний (browser ↔ server ↔ agent), что позволяет расширить поверхность взаимодействия для разработки и отладки.

**Инфраструктурные ограничения, которые определяют архитектуру:**

- **Локальные MCP запрещены** в наших окружениях.
- **Централизованный MCP развернуть затруднительно** — нет инфраструктуры/доступа для развёртывания общего MCP-сервера.
- Следовательно, у агента нет постоянного набора tools/skills, описывающих возможности плагина. Плагин должен **публиковать свой манифест возможностей по фиксированному HTTP-эндпоинту**, чтобы агент обнаруживал их динамически, в момент, когда они нужны, — без skills/rules.

## Текущее состояние плагина

Что уже работает в текущем коде:

**Браузерный клиент (`devLogger/`)** — активен только в dev (`import.meta.hot`):
- Перехват `console.log/info/warn/error`, `window.onerror`, `unhandledrejection`, ошибок загрузки ресурсов, `fetch`/`XHR` (с `method`/`status`/`netUrl`/`durationMs`), Vue `errorHandler`/`warnHandler`.
- Кольцевой буфер (5000 записей) с дедупликацией одинаковых подряд сообщений, маркеры `session`/`truncate`.
- Двусторонний канал: сервер → HMR `dev-exec` → клиент выполняет async-IIFE (поддержка `await`, `return`) → результат `dev-exec-result` обратно.
- HMR-dispose корректно восстанавливает оригиналы и сбрасывает состояние.

**Vite-плагин (`devBrowserLogs.ts`)**:
- `GET /__dev_logs?level=&type=&url=&text=&since=&limit=` — NDJSON из ring-буфера; фильтры комбинируются через AND, системные маркеры проходят сквозь фильтры.
- `GET/POST /__dev_exec?code=&timeout=&id=` — отправляет JS в подключённый браузер, ждёт результат по `id` (10s timeout по умолчанию, очередь до 50 результатов); `?id=` — polling результата.
- Приём логов и exec-результатов через `server.ws.on('dev-log' | 'dev-exec-result', …)`.

## План рефакторинга

Проведено сравнение с [vite-plugin-pilot](https://github.com/2234839/vite-plugin-pilot) — зрелым аналогом с упором на AI-агентов. Полный анализ и ответы на вопросы — в [VITE_PLUGIN_PILOT_ANALYSIS.md](./VITE_PLUGIN_PILOT_ANALYSIS.md), **детальный план рефакторинга с фазами, оценкой трудозатрат и метриками успеха — в [REFACTORING_PLAN.md](./REFACTORING_PLAN.md)**.

Краткий вектор рефакторинга:
- **Phase 0 (подготовка):** разделить `devBrowserLogs.ts` на модули, завести smoke-тесты.
- **Phase 1 (quick wins):** `GET /__agent/manifest`, multi-instance через `instanceId`, cap 100 KB на сериализацию + client-side exec timeout 5s.
- **Phase 2 (snapshot + хелперы):** compact DOM snapshot (формат pilot'а, ~80 строк), хелперы `__agent_*` с поддержкой v-model, raw DOM-снимок для отладки анимаций.
- **Phase 3 (опционально):** Element Inspector через `magic-string` в `transform`-хуке Vite + Alt+Click.

Явно отклонено: standalone-режим, Channel Server, `SKILL.md`, file-bridge канал, триггерный DOM snapshot, CLI-обёртка.

## 1. Дополнительные возможности канала
1.1 Чтение состояния (agent → browser, pull)
Снимок DOM / accessibility tree / React/Vue fiber tree
Дамп сторов (Redux / Zustand / Pinia / MobX) с подпиской на изменения
localStorage / sessionStorage / IndexedDB / cookies
Текущий URL, history, гео/timezone/locale, online/offline
Computed styles для селектора, layout box, viewport
Heap snapshot, performance entries, Long Tasks, CLS/LCP
1.2 Управление браузером (agent → browser, push)
eval() произвольного JS в контексте страницы — аналог Runtime.evaluate в CDP. Базовый примитив, из которого строятся все остальные возможности.
Клики / ввод / scroll / navigation по селектору (мини-Puppeteer без зависимостей).
Перехват и мокирование fetch/XHR: стаб ответов, задержка, принудительные 500.
Переключение feature flags / A-B бакетов / i18n locale без перезапуска.
Горячая перезагрузка данных (tRPC / GraphQL refetch).
1.3 Реактивные уведомления (browser → agent)
Подписки: «сообщи, когда появится элемент .error-banner», «когда придёт mutation Login», «когда упадёт unhandled rejection».
Профилирование «горячих путей»: worker измеряет время и шлёт p95/long-task сводки.
Source-mapped stack traces с контекстом (последние N действий пользователя).
1.4 Debug-специфичные фичи
Скриншот по триггеру + diff с baseline (визуальные регрессы).
Запись и воспроизведение пользовательской сессии (event log).
JS/CSS coverage — подсветка неиспользуемого кода.
Service Worker state, cache contents, push-подписки.
WebSocket / SSE трафик с буферизацией последних N сообщений.
1.5 Приоритет реализации
Реализовать два примитива — eval и снимок DOM — покрывает ~80% сценариев. Остальное наращивается инкрементально.

2. Discovery без skills и rules
2.1 Идея
Плагин публикует манифест возможностей по фиксированному HTTP-эндпоинту. Агент обнаруживает возможности в момент, когда они нужны, без предварительной регистрации.

2.2 Эндпоинт
GET http://localhost:<port>/__agent/manifest
2.3 Формат ответа
{
  "name": "vite-agent-bridge",
  "version": "0.1.0",
  "capabilities": ["eval", "dom-snapshot", "network-log", "..."],
  "tools": [
    {
      "name": "browser_eval",
      "description": "Evaluate JS in page context, return serialized result.",
      "input_schema": {
        "type": "object",
        "properties": {
          "code": { "type": "string" }
        },
        "required": ["code"]
      }
    }
  ],
  "examples": [
    "POST /__agent/eval { \"code\": \"document.title\" }",
    "GET  /__agent/dom?selector=\".error-banner\""
  ],
  "system_hint": "When debugging browser issues, prefer /__agent/* over guessing."
}
2.4 Интеграция с AGENTS.md
Минимальная строка в AGENTS.md (это документация, а не skill/rule):

Dev tooling: `GET http://localhost:<port>/__agent/manifest` exposes browser introspection APIs.
Плагин при необходимости сам дописывает/обновляет эту строку в AGENTS.md через file watch + merge-маркер, чтобы номер порта не расходился с реальностью.

2.5 Преимущества подхода
Манифест живёт рядом с кодом — не расходится с реальностью.
Порт, версия и набор фич подставляются автоматически.
Работает с любым агентом/IDE без дополнительной интеграции.
system_hint подмешивается в контекст агента при первом обращении.
3. Дальнейшие шаги
Реализовать эндпоинт GET /__agent/manifest в плагине.
Реализовать примитивы eval и dom-snapshot как proof of value.
Добавить строку в AGENTS.md рядом с проектом.
Наращивать capability-эндпоинты инкрементально, обновляя манифест.