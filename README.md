# Vite Agent Bridge

**Vite-плагин, дающий AI-агенту «глаза и руки» в dev-браузере через HMR WebSocket — без MCP, без внешних CLI, без дополнительных HTTP-эндпоинтов от браузера.** Канал связи — только HMR WS, существующий в любом Vite-проекте; агент обнаруживает возможности через манифест, выложенный плагином на фиксированный HTTP-эндпоинт.

---

## 1. Контекст и ограничения

**Зачем:** В наших окружениях локальный MCP запрещён, а централизованный MCP-сервер развернуть затруднительно. Значит, у агента нет постоянного набора tools/skills, описывающих плагин. Решение — **runtime-манифест**: плагин публикует свой API по `GET /__agent/manifest`, агент читает его в момент, когда нужны возможности, без предварительной регистрации.

**Принцип канала:** browser ↔ server — **только HMR WebSocket** существующего Vite. Никаких дополнительных HTTP-запросов от браузера наружу: в Network-tab видно лишь обычный Vite HMR WS. Агент общается с сервером по HTTP (`/__agent/*`, плюс legacy `/__dev_*`).

**Скрытность:** в production-сборке плагин не активен. Весь код — dev-only.

---

## 2. Что умеет

| Возможность | Что перехватывает / отдаёт | Пример |
|---|---|---|
| **Console / ошибки** | `console.log/info/warn/error`, `window.onerror`, `unhandledrejection`, ошибки загрузки ресурсов, Vue `errorHandler`/`warnHandler` | авто-сбор, dedup, ring-buffer 5000 |
| **Network** | `fetch` + XHR: `method`, `status`, `netUrl`, `durationMs` | читаются вместе с логами |
| **Логи с фильтрами** | NDJSON-стрим с фильтрами `level`, `type`, `url`, `text`, `since`, `limit`, `instance` | `GET /__dev_logs?level=error&limit=20` |
| **Eval JS в браузере** | async-IIFE с `await`/`return`, client timeout 5 с, serialize cap 100 KB, обработка `Map`/`Set`/`Function`/`BigInt`/`Symbol` | `curl -X POST http://localhost:5173/__dev_exec -d 'code=document.title'` |
| **Список активных вкладок** | `{id, url, title, lastSeen}` + `?since=` | `GET /__agent/instances` |
| **Compact DOM snapshot** | одна строка на узел, ~80 строк на страницу, фокус на области операции | `GET /__agent/dom?format=compact&focus=5&context=3` |
| **Raw DOM snapshot** | JSON-дерево с `attrs` / `styles` / `computed` / `viewportOnly` / `depth` / `maxSize` — для отладки анимаций | `GET /__agent/dom?format=raw&selector=.modal&styles=computed` |
| **8 хелперов `__agent_*`** | `snapshot`, `findByText`, `click`, `clickByText`, `setValueByPlaceholder`, `typeByPlaceholder`, `waitFor`, `wait` — все v-model-safe через native setter + rAF | `await __agent_clickByText('Войти')` через `__dev_exec` |

Полная JSON-схема всех tools — в `GET /__agent/manifest` (см. §5).

---

## 3. Quick start

Сейчас код живёт **in-tree** (планируется npm-пакет — см. [NPM_PUBLISH_PLAN.md](./NPM_PUBLISH_PLAN.md)).

**1. Подключить плагин в `vite.config.ts`:**
```ts
import { defineConfig } from 'vite';
import devBrowserLogs from './server/index';

export default defineConfig({
  plugins: [devBrowserLogs()],
});
```

**2. Инициализировать клиент в `main.ts`:**
```ts
import { initDevLogger } from './client/index';

if (import.meta.env.DEV) {
  initDevLogger();
}
```

**3. Запустить dev-сервер и проверить:**
```bash
npm run dev &
curl -s http://localhost:5173/__agent/manifest | jq .name
# → "vite-agent-bridge"
```

**4. Прочитать логи:**
```bash
curl -s 'http://localhost:5173/__dev_logs?level=error&limit=20'
# → NDJSON-стрим последних ошибок
```

**5. Выполнить JS в браузере:**
```bash
curl -s -X POST 'http://localhost:5173/__dev_exec' \
  -H 'Content-Type: application/json' \
  -d '{"code":"document.title"}'
# → {"ok":true,"value":"...","ts":...}
```

Плагин при первом запуске дописывает в `AGENTS.md` строку со ссылкой на манифест через merge-маркер (`<!-- vite-agent-bridge:begin --> … <!-- vite-agent-bridge:end -->`). Идемпотентно, пользовательский контент вне маркеров сохраняется.

---

## 4. Архитектура

Три актора, один канал (HMR WebSocket), четыре поверхности взаимодействия агента с плагином:

```
┌────────────────────────────────────────────────────────────────────────────┐
│                              VITE DEV SERVER                                │
│  ┌──────────────────────┐    ┌──────────────────────────────────────┐       │
│  │       server/        │    │         instance registry             │       │
│  │  ┌────────────────┐  │    │   Map<instanceId, InstanceState>     │       │
│  │  │ manifest.ts    │──┼────┤   { buffer, lastSeen, meta }         │       │
│  │  │ exec.ts        │  │    └──────────────────────────────────────┘       │
│  │  │ dom.ts         │  │                                                   │
│  │  │ logs.ts        │  │    HMR WebSocket (server.ws.send / .on)           │
│  │  │ instances.ts   │  │            ▲                                       │
│  │  │ index.ts       │  │            │                                       │
│  │  └────────────────┘  │            │                                       │
│  └──────────────────────┘            │                                       │
└───────────────────────────────────────┼───────────────────────────────────┘
                                         │
                                         ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                              BROWSER (dev)                                  │
│  ┌────────────────────────────────────────────────────────────────────┐    │
│  │                           client/                                   │    │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌──────────────────┐    │    │
│  │  │ interceptors/   │  │ channels/       │  │ helpers/         │    │    │
│  │  │  console        │  │  execChannel    │  │  agentHelpers    │    │    │
│  │  │  network        │  │  instanceReg    │  │                  │    │    │
│  │  │  globalErrors   │  │  domChannel     │  │                  │    │    │
│  │  │  vue            │  │                 │  │                  │    │    │
│  │  └─────────────────┘  └─────────────────┘  └──────────────────┘    │    │
│  │                                                                     │    │
│  │  ┌─────────────────────────────────────────────────────────────┐    │    │
│  │  │ core: ringBuffer, dedup, lifecycle, serialize, …            │    │    │
│  │  └─────────────────────────────────────────────────────────────┘    │    │
│  └────────────────────────────────────────────────────────────────────┘    │
└────────────────────────────────────────────────────────────────────────────┘
                                         ▲
                                         │ HTTP /__agent/*  +  /__dev_*  (legacy)
                                         │
                               ┌─────────────────────┐
                               │      AI Agent       │
                               │  (curl, скрипты)    │
                               └─────────────────────┘
```

**Канал browser ↔ server — только HMR WS.** Никаких дополнительных HTTP-эндпоинтов от браузера наружу. Агент общается с сервером по HTTP.

### Зоны ответственности модулей

#### Сервер (`server/`)

| Модуль | Отвечает за |
|---|---|
| `index.ts` | Vite plugin factory; регистрирует middleware и WS-слушатели; сбрасывает state при `configureServer` |
| `middleware.ts` | Общий роутер, делегирующий по префиксу URL конкретным модулям |
| `instanceRegistry.ts` | Хранение `Map<InstanceId, InstanceState>`; маркеры `session`/`truncate` per-instance |
| `manifest.ts` | `GET /__agent/manifest` — JSON со схемами tools |
| `logs.ts` | `GET /__dev_logs` (legacy) с фильтрами `level`/`type`/`url`/`text`/`since`/`limit`/`instance` |
| `exec.ts` | `POST /__dev_exec` — принимает код, шлёт в WS, ждёт результат по `id` |
| `dom.ts` | `GET /__agent/dom?format=compact\|raw` — снапшот DOM |
| `instances.ts` | `GET /__agent/instances` — список активных вкладок с `?since=` |
| `agentsMd.ts` | Утилита merge-патча `AGENTS.md` |
| `types.ts` | `InstanceState`, `LogPayload`, `ManifestTool`, … |

#### Клиент (`client/`)

| Модуль | Отвечает за |
|---|---|
| `index.ts` | `initDevLogger()` — идемпотентная установка всех перехватчиков и каналов; HMR-dispose |
| `constants.ts` | HMR event names, defaults |
| `types.ts` | `InstanceId`, `AgentMessageEnvelope`, … |
| `core/originals.ts` | Оригиналы `console`/`fetch`/`XHR` + `trackedListeners` |
| `core/dedup.ts` | Сравнение последнего сообщения с новым; `flushDuplicates` / `resetDedupState` |
| `core/flushQueue.ts` | Rate limiting через `queueMicrotask` + `maxBatch` |
| `core/listeners.ts` | `addTrackedListener` |
| `core/logFormat.ts` | `formatArgs`, `formatReason`, `maxArgLen` |
| `core/logPayload.ts` | `createLog` + `LogInput` + `nowTs`/`pageUrl` |
| `core/errorHelpers.ts` | `findError`, `getStack`, `getComponentName` |
| `core/execTimeout.ts` | `ExecTimeoutError` + `withTimeout` |
| `core/serialize.ts` | `safeSerialize(value, {maxSize})` — JSON с cap + таймаут + защита от cyclic |
| `interceptors/console.ts` | `console.log/info/warn/error` |
| `interceptors/network.ts` | `fetch` + XHR (method/status/netUrl/durationMs) |
| `interceptors/globalErrors.ts` | `window.onerror` + `unhandledrejection` |
| `interceptors/vue.ts` | Vue `app.config.errorHandler`/`warnHandler` |
| `channels/instanceReg.ts` | Генерация `instanceId`, регистрация + heartbeat (30 с), обновление при `popstate`/`pushState` |
| `channels/execChannel.ts` | Слушает `dev-exec`, выполняет через `new Function`, шлёт `dev-exec-result`; применяет `serialize` + client timeout |
| `channels/domChannel/` | Слушает `dev-dom-request`, собирает DOM (compact или raw), шлёт `dev-dom-response` |
| `helpers/agentHelpers/` | Регистрирует `globalThis.__agent_*` — v-model-safe обёртки |

---

## 5. Структура файлов

```
hmr devtools/
├── README.md                       ← этот файл
├── NPM_PUBLISH_PLAN.md             ← план подготовки к публикации в npm
├── AGENTS.md                       ← правила для субагентов
├── package.json                    ← npm scripts (verify = typecheck + lint + test + coverage)
├── tsconfig.json
├── vitest.config.ts
├── eslint.config.js
├── .prettierrc.json
│
├── server/                         ← серверная часть (Node, Vite plugin)
│   ├── index.ts                    ← Vite plugin factory, configureServer
│   ├── types.ts                    ← InstanceState, LogPayload, ManifestTool, …
│   │
│   ├── manifest.ts                 ← GET /__agent/manifest
│   ├── logs.ts                     ← GET /__dev_logs (legacy) + фильтры
│   ├── exec.ts                     ← POST /__dev_exec
│   ├── dom.ts                      ← GET /__agent/dom?format=compact|raw
│   ├── instances.ts                ← GET /__agent/instances
│   │
│   ├── instanceRegistry.ts         ← Map<InstanceId, InstanceState>
│   ├── agentsMd.ts                 ← merge-патч AGENTS.md
│   └── middleware.ts               ← общий router
│
├── client/                         ← клиентская часть (браузер, dev only)
│   ├── index.ts                    ← initDevLogger() — точка входа
│   ├── constants.ts                ← HMR event names, defaults
│   ├── types.ts                    ← InstanceId, AgentMessageEnvelope, …
│   │
│   ├── core/
│   │   ├── originals.ts            ← оригиналы + trackedListeners
│   │   ├── dedup.ts                ← sendLog + dedup state
│   │   ├── flushQueue.ts           ← rate limiting через queueMicrotask
│   │   ├── listeners.ts            ← addTrackedListener
│   │   ├── index.ts                ← barrel re-export (back-compat)
│   │   ├── logFormat.ts            ← formatArgs, formatReason, maxArgLen
│   │   ├── logPayload.ts           ← createLog + LogInput + nowTs/pageUrl
│   │   ├── errorHelpers.ts         ← findError, getStack, getComponentName
│   │   ├── execTimeout.ts          ← ExecTimeoutError + withTimeout
│   │   └── serialize.ts            ← safeSerialize с cap + таймаут + cyclic
│   │
│   ├── interceptors/
│   │   ├── console.ts
│   │   ├── network.ts
│   │   ├── globalErrors.ts
│   │   └── vue.ts
│   │
│   ├── channels/
│   │   ├── instanceReg.ts
│   │   ├── execChannel.ts
│   │   └── domChannel/
│   │       ├── index.ts
│   │       ├── types.ts
│   │       ├── interactive.ts
│   │       ├── compact.ts
│   │       └── raw.ts
│   │
│   └── helpers/
│       └── agentHelpers/
│           ├── index.ts            ← installAgentHelpers + globalThis
│           ├── cache.ts            ← snapshot cache для __agent_click(idx)
│           ├── queries.ts          ← __agent_snapshot / __agent_findByText
│           ├── interactions.ts     ← __agent_click / setValue / type
│           ├── waits.ts            ← __agent_wait / __agent_waitFor
│           └── timing.ts           ← rafFrame / waitMs
│
├── __tests__/                      ← vitest, environment: jsdom
│   ├── helpers.ts
│   ├── agentHelpers.test.ts
│   ├── agentsMd.test.ts
│   ├── buffer.test.ts
│   ├── dom.test.ts
│   ├── domChannel.test.ts
│   ├── exec.test.ts
│   ├── execChannel.test.ts
│   ├── execInstance.test.ts
│   ├── execTimeout.test.ts
│   ├── instanceReg.test.ts
│   ├── instanceRegistry.test.ts
│   ├── instances.test.ts
│   ├── logsInstance.test.ts
│   ├── manifest.test.ts
│   ├── middleware.test.ts
│   └── serialize.test.ts
│
└── coverage/                       ← AUTO-GENERATED, gitignored
    ├── index.html                  ← точка входа в HTML-отчёт
    ├── client/                     ← per-file coverage клиентских модулей
    └── server/                     ← per-file coverage серверных модулей
```

---

## 6. Контракты протокола

### 6.1 HMR-сообщения (browser ↔ server)

Все сообщения оборачиваются в `Envelope { v: 1, ...payload }` для возможности версионирования.

| Event | Направление | Payload |
|---|---|---|
| `dev-instance-register` | browser → server | `{ id: InstanceId, url, title, ts }` |
| `dev-instance-heartbeat` | browser → server | `{ id, ts }` (раз в 30 с) |
| `dev-log` | browser → server | `{ id: InstanceId, ts, level, type, msg, url?, stack?, method?, status?, netUrl?, durationMs? }` |
| `dev-exec` | server → browser | `{ id: RequestId, code }` |
| `dev-exec-result` | browser → server | `{ id: RequestId, fromInstance: InstanceId, ok, value?, error?, ts }` |
| `dev-dom-request` | server → browser | `{ id: RequestId, spec: { format, selector?, focus?, context?, depth?, attrs?, styles?, viewportOnly?, maxSize? } }` |
| `dev-dom-response` | browser → server | `{ id: RequestId, fromInstance: InstanceId, ok, result?, error? }` |

### 6.2 HTTP-эндпоинты (agent ↔ server)

| Метод | URL | Назначение |
|---|---|---|
| `GET` | `/__agent/manifest` | JSON со схемами tools |
| `GET` | `/__agent/instances` | Список активных вкладок (поддерживает `?since=`) |
| `POST` | `/__agent/eval` | Запланирован (Phase 1.5+), пока не реализован — используйте `/__dev_exec` |
| `GET` | `/__agent/dom?format=compact&...` | Compact DOM снапшот (text) |
| `GET` | `/__agent/dom?format=raw&...` | Raw DOM снапшот (JSON-дерево с attrs/styles/computed) |
| `GET` | `/__dev_logs?level=&type=&url=&text=&since=&limit=&instance=` | NDJSON-стрим логов (legacy) |
| `GET` / `POST` | `/__dev_exec?code=&timeout=&id=&instance=` | Legacy exec-эндпоинт |

При >1 активной вкладке `?instance=` обязателен для `__dev_logs` и `__dev_exec` (иначе 400 + список). При ровно 1 вкладке — параметр опционален (back-compat).

### 6.3 Пример манифеста

```json
{
  "v": 1,
  "name": "vite-agent-bridge",
  "version": "0.2.0",
  "port": 5173,
  "system_hint": "When debugging browser issues, prefer /__agent/* over guessing.",
  "capabilities": ["logs", "eval", "dom-compact", "dom-raw", "instances"],
  "tools": [
    {
      "name": "browser_logs",
      "description": "Read dev log buffer with filters.",
      "endpoint": "GET /__dev_logs",
      "input_schema": {
        "type": "object",
        "properties": {
          "level":    { "type": "string", "enum": ["debug","info","warn","error"] },
          "type":     { "type": "string" },
          "url":      { "type": "string", "description": "substring match" },
          "text":     { "type": "string", "description": "case-insensitive" },
          "since":    { "type": "string", "format": "date-time" },
          "limit":    { "type": "integer", "minimum": 1 },
          "instance": { "type": "string" }
        }
      }
    },
    {
      "name": "browser_eval",
      "description": "Evaluate JS in page context, return serialized result.",
      "endpoint": "POST /__agent/eval",
      "input_schema": {
        "type": "object",
        "required": ["code"],
        "properties": {
          "code":     { "type": "string" },
          "timeout":  { "type": "integer", "minimum": 100, "default": 5000 },
          "instance": { "type": "string" }
        }
      }
    },
    {
      "name": "browser_dom",
      "description": "Snapshot of DOM — compact (~80 lines) or raw (with attrs/computed styles).",
      "endpoint": "GET /__agent/dom",
      "input_schema": {
        "type": "object",
        "properties": {
          "format":       { "type": "string", "enum": ["compact", "raw"], "default": "compact" },
          "selector":     { "type": "string" },
          "focus":        { "type": "integer", "description": "highlight + context lines (compact only)" },
          "context":      { "type": "integer", "default": 4 },
          "depth":        { "type": "integer", "default": 5 },
          "attrs":        { "type": "string", "enum": ["all", "interactive", "none"], "default": "interactive" },
          "styles":       { "type": "string", "enum": ["none", "inline", "computed"], "default": "none" },
          "viewportOnly": { "type": "boolean", "default": false },
          "maxSize":      { "type": "integer", "default": 500000 },
          "instance":     { "type": "string" }
        }
      }
    },
    {
      "name": "browser_instances",
      "description": "List active browser instances.",
      "endpoint": "GET /__agent/instances",
      "input_schema": { "type": "object", "properties": {} }
    }
  ],
  "examples": [
    "GET /__agent/manifest",
    "POST /__agent/eval {\"code\":\"document.title\"}",
    "GET /__agent/dom?format=compact&focus=3",
    "GET /__agent/dom?format=raw&selector=.modal&styles=computed"
  ]
}
```

---

## 7. Потоки данных

### 7.1 Захват console.error

```
[Browser]                                       [Vite Dev Server]                  [Agent]
console.error('boom')
   │
   ▼
interceptors/console.ts
   wrap(originalConsoleError)
   ─► dedup ─► ringBuffer.push({level:'error',
                                 type:'console',
                                 msg:'boom', ...})
   ─► import.meta.hot.send('dev-log', envelope)

                                                  ▼
                                           server.ws.on('dev-log')
                                                  │
                                                  ▼
                                           instanceRegistry.pushToInstance(id, entry)
                                                  │  ringBuffer per-instance
                                                  │  if overflow → truncate-marker
                                                  ▼
                                           ready for /__dev_logs
                                                                                        │
                                                                                        │  GET /__dev_logs?level=error&limit=20
                                                                                        ◄──────────────────────
                                                                                                           ▼
                                                                                                   NDJSON: {ts, level, type, msg, ...}
```

**Поток полностью push:** браузер → WS → сервер. Агент читает по запросу.

### 7.2 Multi-instance: две вкладки

```
[Browser Tab A]                       [Vite Dev Server]                       [Browser Tab B]
initDevLogger()                       instanceRegistry = Map {
  id = 'a1'                             'a1': { buffer: [...], meta: {url: '/login', title: 'Login'} },
  hot.send('dev-instance-register', {     'b2': { buffer: [...], meta: {url: '/dashboard', title: 'Home'} }
    id:'a1', url:'/login'...           }
  })                                   │
                                       │
[Tab B]                                │
initDevLogger()                        │
  id = 'b2'                            │
  hot.send('dev-instance-register', {  │
    id:'b2', url:'/dashboard'...       │
  })                                   │
                                       │
  ─► each tab only writes to its own entry in the map.
  ─► if only one instance registered: ?instance= is OPTIONAL (back-compat).
  ─► if >1: GET /__agent/instances first, then pass ?instance=a1.
```

### 7.3 Eval JS в браузере

```
[Agent]                                       [Vite Dev Server]                            [Browser]
POST /__agent/eval
{code:"document.querySelector('.modal')?.textContent"}
   │
   ▼
exec.ts: enqueueExec(code, 5000)
   id = crypto.randomUUID()
   pendingExec.set(id, resolver)
   server.ws.send({event:'dev-exec', data:{id, code}})
                                                  │
                                                  ▼
                                           [Tab receives dev-exec]
                                                  │
                                                  ▼
                                           execChannel.ts:
                                             new Function('"use strict"; return (async()=>{'+code+'})();')()
                                             await value
                                             safeSerialize(value, {maxSize:100_000})
                                                  │
                                             hot.send('dev-exec-result', envelope)
                                                                                         │
                                                                                         ▼
                                                                                 server.ws.on('dev-exec-result')
                                                                                         │
                                                                                         ▼
                                                                                 pendingExec.get(id)(entry)
                                                                                         │
                                                                                         ▼
                                                                                 respond JSON {ok, value, ts}
   ◄────────────────────────────────────────────────────────────────────────────────────
```

**Таймауты:**
- Клиент: `Promise.race` с 5s, при таймауте — `Error('Execution timed out after 5000ms')`.
- Сервер: 10s wait for response (default), `?timeout=` overrides.
- Сериализация: cap 100 KB → `{ok:true, truncated:true, preview, sizeBytes}`.

### 7.4 Compact DOM snapshot

```
[Agent]                                                        [Browser]
GET /__agent/dom?format=compact&focus=5&context=3
   │
   ▼
dom.ts: enqueueDomRequest(spec)
   id = crypto.randomUUID()
   pendingDom.set(id, resolver)
   server.ws.send({event:'dev-dom-request', data:{id, spec})
                                                                ▼
                                                        domChannel.ts:
                                                          spec.format === 'compact'
                                                            → walk DOM, build
                                                              tag#idx[attrs] text
                                                              lines
                                                            → apply focus: ±context
                                                              around #focus, others → '·'
                                                            → return string
                                                          spec.format === 'raw'
                                                            → walk DOM, build
                                                              {tag, attrs, computed?,
                                                              children[]} JSON tree
                                                              respecting depth/attrs/styles
                                                            → safeSerialize(...)
                                                          hot.send('dev-dom-response', envelope)
   ◄───────────────────────────────────────────────────────────────────────────────────
{ "lines": "form#login[disabled] Войти\n  input#email...\n  ...", "matches": 1 }
```

**Compact-формат** (одна строка на узел, ~80 строк):
```
form#login-form[disabled] Войти
  input#email[type=email][ph="Email"]
  input#password[type=password][ph="Пароль"]
· · · · · · · · · · · · · · · · · · · · · · · · · · ·
→ button#submit[type=submit] Войти      ← focus=5
· · · · · · · · · · · · · · · · · · · · · · · · · · ·
  a.link[href=/forgot] Забыли пароль?
```

### 7.5 Сырой DOM (для анимаций)

```
GET /__agent/dom?format=raw&selector=.modal&styles=computed&depth=10&maxSize=500000
```

Возвращает JSON:
```json
{
  "selector": ".modal",
  "matches": 1,
  "tree": [{
    "tag": "div",
    "attrs": {
      "class": "modal modal--enter-active",
      "data-state": "opening",
      "aria-hidden": "false",
      "style": "transform: translateX(-50%)"
    },
    "computed": {
      "transform": "matrix(1, 0, 0, 1, -240, 0)",
      "opacity": "0.7",
      "animation-name": "modalEnter",
      "animation-duration": "0.3s",
      "animation-play-state": "running"
    },
    "children": [ ... ]
  }]
}
```

Этот снимок видит **промежуточное состояние анимации** (`.modal--enter-active`, transform matrix), которое compact-снапшот не ловит.

### 7.6 Хелпер `__agent_clickByText` (v-model-safe)

```
[Agent]                                            [Browser]
POST /__agent/eval
{code: "await __agent_clickByText('Войти')"}
   │
   ▼
server: dev-exec → browser                        execChannel.ts:
                                                   new Function('"use strict"; return (async()=>{'+code+'})();')()
                                                     │
                                                     ▼
                                                   helper __agent_clickByText:
                                                     find element by text (DOM walker)
                                                     fire click() (mousedown/mouseup/click)
                                                     wait 1 rAF for v-model flush
                                                     return {found: true, idx: 3}
                                                     │
                                                     ▼
                                                   hot.send('dev-exec-result', {ok:true, value:'{"found":true,"idx":3}'})
   ◄────────────────────────────────────────────────
{ok: true, value: '{"found":true,"idx":3}'}
```

### 7.7 Lifecycle (HMR dispose)

При изменении `client/index.ts` или любого его зависимого файла Vite делает HMR dispose:

```
import.meta.hot.dispose(() => {
    // восстановить console.*, fetch, XHR.open/send
    // снять window слушатели (window.onerror, unhandledrejection)
    // сбросить installed=false
    // сбросить ringBuffer, dedupState
    // instanceRegistry.remove(id) — нота серверу что вкладка ушла
});
```

Сервер при `configureServer` (новый запуск плагина) тоже сбрасывает registry.

---

## 8. Сквозные правила

| Что | Где реализовано | Правило |
|---|---|---|
| **HMR-only канал** | `client/core/lifecycle.ts`, `client/channels/*` | Браузер шлёт ТОЛЬКО через `import.meta.hot.send`. Сервер шлёт ТОЛЬКО через `server.ws.send`. |
| **Instance isolation** | `server/instanceRegistry.ts`, все envelope-сообщения | Каждое сообщение содержит `instanceId`; пишется/читается только в свой буфер. |
| **System markers** | `client/core/ringBuffer.ts`, `server/logs.ts` | `session` и `truncate` проходят сквозь все фильтры (`isSystem` shortcut). |
| **Размер ответа** | `client/core/serialize.ts`, `client/channels/domChannel/raw.ts` | JSON cap 100 KB (eval), 500 KB (raw DOM); при превышении — `truncated:true` + preview. |
| **Exec timeout** | `client/channels/execChannel.ts`, `server/exec.ts` | 5s на клиенте + 10s на сервере (overridable через `?timeout=`). |
| **Дедуп** | `client/core/dedup.ts` | Два подряд идентичных сообщения склеиваются; счётчик в маркере. |
| **HMR-dispose корректность** | `client/index.ts`, `client/core/listeners.ts` | Каждый перехватчик имеет пару «установить/снять»; `trackedListeners` реестр для `window`-слушателей. |
| **Скрытность в Network** | Контракт — только WS | В браузерной Network-вкладке видно только Vite HMR WebSocket. Никаких дополнительных запросов от браузера наружу. |
| **Coverage gate** | `vitest.config.ts`, `package.json` | Quality gate. Провайдер `v8`, reporter `text` + `html`, include `client/**` + `server/**`. Глобальные thresholds: `lines ≥ 70`, `branches ≥ 70`, `functions ≥ 80`, `statements ≥ 70` (`perFile: false`). Exclude: `client/index.ts`, `client/interceptors/**`, `client/core/index.ts`, `client/helpers/agentHelpers/index.ts` — jsdom не имеет `import.meta.hot`, этот код делает early return и не может быть покрыт в unit-тестах. `npm run verify` запускает coverage как обязательный gate: нарушение порога → exit ≠ 0. |

---

## 9. Типичный цикл работы агента

```
1. Agent в начале сессии читает AGENTS.md (там плагин дописал ссылку на /__agent/manifest).
2. GET /__agent/manifest            → получает список tools со схемами.
3. GET /__agent/instances           → видит, какие вкладки подключены.
4. POST /__dev_exec {code:"await __agent_snapshot()"}      → видит структуру страницы.
5. POST /__dev_exec {code:"await __agent_clickByText('Войти')"}   → взаимодействует.
6. GET /__dev_logs?level=error&limit=20&instance=a1        → разбирает упавшее.
7. GET /__agent/dom?format=raw&selector=.modal&styles=computed    → расследует анимационный баг.
8. POST /__dev_exec {code:"await __agent_waitFor('Спасибо', 5000)"}  → ждёт результат.
```

---

## 10. Что НЕ входит

Явно отклонено (и в ближайших фазах не планируется):

| Что | Почему |
|---|---|
| Standalone-режим без Vite | Агент не управляет браузером; светит HTTP. |
| Channel Server (browser → MCP stdio) | MCP stdio запрещён в наших окружениях. |
| `SKILL.md` / `SETUP.md` | MCP/skill-регистрация недоступна; манифест покрывает ту же задачу. |
| File-bridge канал (`.pilot/pending-js.txt`) | HMR WS достаточно. |
| Клиентский rate-limit / батч | Штормов `console.log` в проекте пока не наблюдается; добавим точечно при необходимости. |
| Триггерный DOM snapshot (массив с интервалом) | Отложен. |
| CLI-обёртка (`npx agent run …`) | Агент работает curl-ом напрямую. Опционально позже. |
| Element Inspector (Alt+Click + `magic-string`) | Phase 3, опционально — низкий приоритет; полезен только при интерактивной отладке с человеком. |
| Подписки (browser → agent) «сообщи, когда появится элемент» | Не входит в Phase 1–2; возможно позже через долгий poll на `/__dev_logs?since=…`. |

---

## 11. Тестирование

- **176 тестов проходят + 1 todo**, `npm run verify` зелёный (typecheck + lint + test + coverage).
- Тесты лежат в `__tests__/**/*.test.ts`. Vitest, environment `jsdom`.
- Coverage gate: `lines ≥ 70`, `branches ≥ 70`, `functions ≥ 80`, `statements ≥ 70` (глобально).
- Команды:
  - `npm run verify` — полный quality gate (typecheck + lint + test + coverage).
  - `npm run test:coverage` — детальный coverage-отчёт (stdout + HTML в `coverage/index.html`, gitignored).
  - `npm run test` — только unit-тесты.

---

## 12. Резюме

- **Один канал** (HMR WS) для всего browser↔server трафика.
- **Один registry** (`Map<InstanceId, InstanceState>`) разруливает много вкладок.
- **Один manifest** (`/__agent/manifest`) описывает все tools с JSON-schema — для агентов без MCP.
- **Два формата DOM** (compact для экономии токенов, raw для отладки анимаций) — ортогональны, выбираются параметром `format`.
- **Один набор хелперов** (`__agent_*`) — v-model-safe обёртки над нативным DOM.
- **Старые эндпоинты** (`/__dev_logs`, `/__dev_exec`) живут параллельно как backward-compat.
- **Phase 3** (Element Inspector, Alt+Click) добавляется отдельно и не ломает ничего из вышеописанного.
- **npm-публикация** — см. [NPM_PUBLISH_PLAN.md](./NPM_PUBLISH_PLAN.md).