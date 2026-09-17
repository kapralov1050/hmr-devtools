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

> Реализовано в рамках Phase 0–2 (см. [REFACTORING_PLAN.md](./REFACTORING_PLAN.md)). Phase 3 (Element Inspector) — опционально, не реализовано.

### Браузерный клиент (`devLogger/`, dev only)

- **Перехват:** `console.log/info/warn/error`, `window.onerror`, `unhandledrejection`, ошибки загрузки ресурсов, `fetch`/`XHR` (с `method`/`status`/`netUrl`/`durationMs`), Vue `errorHandler`/`warnHandler`.
- **Дедуп + ring-buffer:** 5000 записей per-instance, дедупликация одинаковых подряд сообщений, маркеры `truncate` (а `session` теперь per-instance).
- **Multi-instance:** каждый клиент генерирует свой `instanceId` (timestamp + random), регистрируется через `dev-instance-register` + `dev-instance-heartbeat` (30 с).
- **Eval канал:** async-IIFE с `await`/`return`, **client-side timeout 5 с** через `withTimeout` + `ExecTimeoutError`.
- **Безопасная сериализация:** `safeSerialize()` с **cap 100 KB**, цикл-детект через JSON-throw, tagged-replacer для `Map`/`Set`/`Function`/`BigInt`/`Symbol`, `truncatePreview` для больших результатов.
- **DOM-канал:** `initDomChannel()` отвечает на `dev-dom-request` envelope, отдаёт `dev-dom-response`.
- **Хелперы `__agent_*`:** `__agent_snapshot`, `__agent_findByText`, `__agent_click`, `__agent_clickByText`, `__agent_setValueByPlaceholder` (v-model safe через native setter), `__agent_typeByPlaceholder`, `__agent_waitFor`, `__agent_wait`.
- **HMR-dispose:** корректно восстанавливает все оригиналы, сбрасывает state, очищает heartbeat.

### Vite-плагин (`devBrowserLogs/`)

| Метод | URL | Назначение |
|---|---|---|
| `GET` | `/__dev_logs` (legacy) | NDJSON-стрим буфера с фильтрами `level`/`type`/`url`/`text`/`since`/`limit`/`instance=` |
| `GET` / `POST` | `/__dev_exec` (legacy) | Выполнение JS в браузере, polling по `?id=` |
| `GET` | `/__agent/manifest` | JSON-манифест с 4 tools и JSON-schema |
| `GET` | `/__agent/instances` | Список активных вкладок с `id`/`url`/`title`/`lastSeen` (поддерживает `?since=`) |
| `GET` | `/__agent/dom` | Снапшот DOM: `format=compact` (text, ~80 строк, фокус на области операции) или `format=raw` (JSON-дерево с attrs/styles/computed/viewportOnly/depth/maxSize) |
| `POST` | `/__agent/eval` | Запланирован (Phase 1.5+ в плане), пока не реализован — используйте `/__dev_exec` |

Multi-instance: при >1 активных вкладках `?instance=` обязателен для `__dev_logs` и `__dev_exec` (иначе 400 + список). При ровно 1 вкладке — параметр опционален (back-compat).

**Автопатч AGENTS.md:** при `configureServer` плагин добавляет/обновляет в проекте блок `<!-- vite-agent-bridge:begin --> ... <!-- vite-agent-bridge:end -->` со ссылкой на манифест. Идемпотентно, пользовательский контент вне маркеров сохраняется.

**Тесты:** 182 теста (16 файлов), `npm run verify` зелёный (typecheck + lint + test).

### Структура файлов

```
devBrowserLogs/                  ← server (Node, Vite plugin)
├── index.ts                     ← Vite plugin factory
├── middleware.ts                ← роутер, регистрирует WS + HTTP
├── manifest.ts                  ← GET /__agent/manifest
├── instances.ts                 ← GET /__agent/instances
├── dom.ts                       ← GET /__agent/dom
├── exec.ts                      ← /__dev_exec + dev-exec-result
├── logs.ts                      ← /__dev_logs + dev-log
├── agentsMd.ts                  ← AGENTS.md merge-маркер
├── instanceRegistry.ts          ← Map<InstanceId, InstanceEntry>
└── types.ts                     ← DevLogsContext

devLogger/                       ← client (браузер, dev only)
├── index.ts                     ← initDevLogger() — точка входа
├── constants.ts                 ← пути + HMR events + defaults
├── types.ts                     ← LogPayload, Instance*, Manifest*, DomSpec
├── core/                        ← ringBuffer, dedup, lifecycle, serialize, execTimeout
├── interceptors/                ← console, network, globalErrors, vue
├── channels/                    ← instanceReg, execChannel, domChannel
└── helpers/agentHelpers.ts      ← __agent_* на globalThis
```

## План дальнейшего развития

Сравнение с [vite-plugin-pilot](https://github.com/2234839/vite-plugin-pilot) — в [VITE_PLUGIN_PILOT_ANALYSIS.md](./VITE_PLUGIN_PILOT_ANALYSIS.md); детальный план с фазами, оценкой и метриками — в [REFACTORING_PLAN.md](./REFACTORING_PLAN.md); целевая архитектура с потоками данных — в [ARCHITECTURE.md](./ARCHITECTURE.md); процесс работы с субагентами — в [WORKFLOW.md](./WORKFLOW.md).

### ✅ Завершено (Phase 0–2)

| Фаза | Блок | Что |
|---|---|---|
| 0 | B0.1 | devBrowserLogs.ts → 5 модулей (`index`/`middleware`/`exec`/`logs`/`types`) |
| 0 | B0.2 | Расширены `constants.ts` (эндпоинты `/__agent/*`, HMR-events, defaults) |
| 0 | B0.3 | Расширены `types.ts` (`InstanceId`/`State`/`Manifest*`/`DomSpec`/`AgentEnvelope`) |
| 0 | B0.4 | 18 smoke-тестов для `/__dev_logs` и `/__dev_exec` |
| 1 | B1.1 | `GET /__agent/manifest` с 4 tools + JSON-schema |
| 1 | B1.2 | Multi-instance через `instanceId` (per-instance ring-buffer, `?instance=` фильтр) |
| 1 | B1.3 | `GET /__agent/instances` (список вкладок с метаданными + `?since=`) |
| 1 | B1.4 | `safeSerialize` (100 KB cap, cyclic, tagged-replacer) + `withTimeout` (5 с) |
| 1 | B1.5 | AGENTS.md merge-маркер через `patchAgentsMd` |
| 2 | B2.1 | `GET /__agent/dom?format=compact` (~80 строк, фокус на области операции) |
| 2 | B2.2 | Хелперы `__agent_*` (v-model-safe клики/ввод/wait/snapshot) |
| 2 | B2.3 | `GET /__agent/dom?format=raw` (attrs/styles/computed/viewportOnly/depth/maxSize) |

### ⏳ Не сделано (Phase 3+, опционально)

- **Element Inspector** (Alt+Click + `magic-string` в `transform`-хуке) — низкий приоритет; полезен только при интерактивной отладке с человеком.
- **`POST /__agent/eval`** — алиас для `/__dev_exec` через манифест.
- **Триггерный DOM snapshot** (массив с интервалом) — отложен.
- **npm-пакет** (Phase 3 npm): реструктуризация в `src/{server,client}/`, `package.json`, CI, публикация. Подробности в [ARCHITECTURE.md §11](./ARCHITECTURE.md).

### Явно отклонено

standalone-режим, Channel Server, `SKILL.md`, file-bridge канал, клиентский rate-limit, CLI-обёртка. Обоснование в [VITE_PLUGIN_PILOT_ANALYSIS.md §8](./VITE_PLUGIN_PILOT_ANALYSIS.md).

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