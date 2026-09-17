# Архитектура Vite Agent Bridge (целевое состояние)

> Основа: текущий код (`devLogger/`, `devBrowserLogs.ts`) + [REFACTORING_PLAN.md](./REFACTORING_PLAN.md) + [VITE_PLUGIN_PILOT_ANALYSIS.md](./VITE_PLUGIN_PILOT_ANALYSIS.md).
> Документ описывает, как будет устроено решение **после рефакторинга Phase 0–2** (без Phase 3 — Element Inspector).

---

## 1. Общая картина

Три актора, один канал (HMR WebSocket), четыре поверхности взаимодействия агента с плагином:

```
┌────────────────────────────────────────────────────────────────────────────┐
│                              VITE DEV SERVER                                │
│  ┌──────────────────────┐    ┌──────────────────────────────────────┐       │
│  │   devBrowserLogs/    │    │          instance registry           │       │
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
│  │                           devLogger/                                │    │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌──────────────────┐    │    │
│  │  │ interceptors/   │  │ channels/       │  │ helpers/         │    │    │
│  │  │  console        │  │  execChannel    │  │  agentHelpers    │    │    │
│  │  │  network        │  │  instanceReg    │  │  serialize       │    │    │
│  │  │  globalErrors   │  │  domChannel     │  │                  │    │    │
│  │  │  vue            │  │                 │  │                  │    │    │
│  │  └─────────────────┘  └─────────────────┘  └──────────────────┘    │    │
│  │                                                                     │    │
│  │  ┌─────────────────────────────────────────────────────────────┐    │    │
│  │  │ core: ringBuffer, dedup, lifecycle, types                   │    │    │
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

---

## 2. Структура файлов (целевая)

```
hmr devtools/
├── README.md
├── REFACTORING_PLAN.md
├── ARCHITECTURE.md                        ← этот файл
├── VITE_PLUGIN_PILOT_ANALYSIS.md
│
├── server/                                ← серверная часть (Node, Vite plugin)
│   ├── index.ts                           ← Vite plugin factory, configureServer
│   ├── types.ts                           ← InstanceState, LogPayload, ManifestTool, …
│   │
│   ├── manifest.ts                        ← GET /__agent/manifest
│   ├── logs.ts                            ← GET /__dev_logs (legacy) + фильтры
│   ├── exec.ts                            ← POST /__dev_exec + GET /__agent/eval
│   ├── dom.ts                             ← GET /__agent/dom?format=compact|raw
│   ├── instances.ts                       ← GET /__agent/instances
│   │
│   ├── instanceRegistry.ts                ← Map<InstanceId, InstanceState>
│   ├── agentsMd.ts                        ← утилита для merge-патча AGENTS.md
│   └── middleware.ts                      ← общий router для server.middlewares.use
│
├── client/                                ← клиентская часть (браузер, dev only)
│   ├── index.ts                           ← initDevLogger() — точка входа
│   ├── constants.ts                       ← HMR event names, defaults
│   ├── types.ts                           ← InstanceId, AgentMessageEnvelope, …
│   │
│   ├── core/
│   │   ├── originals.ts                   ← оригиналы console/fetch/XHR + trackedListeners
│   │   ├── dedup.ts                       ← sendLog + dedup state + flushDuplicates/resetDedupState
│   │   ├── flushQueue.ts                  ← rate limiting через queueMicrotask + maxBatch
│   │   ├── listeners.ts                   ← addTrackedListener
│   │   ├── index.ts                       ← barrel re-export (back-compat с @/core)
│   │   ├── logFormat.ts                   ← formatArgs, formatReason, maxArgLen
│   │   ├── logPayload.ts                  ← createLog + LogInput + nowTs/pageUrl
│   │   ├── errorHelpers.ts                ← findError, getStack, getComponentName
│   │   ├── execTimeout.ts                 ← ExecTimeoutError + withTimeout
│   │   └── serialize.ts                   ← JSON с cap + таймаут + защита от cyclic
│   │
│   ├── interceptors/
│   │   ├── console.ts                     ← console.log/info/warn/error
│   │   ├── network.ts                     ← fetch + XHR (method/status/netUrl/durationMs)
│   │   ├── globalErrors.ts                ← window.onerror + unhandledrejection
│   │   └── vue.ts                         ← Vue app.config.errorHandler/warnHandler
│   │
│   ├── channels/
│   │   ├── instanceReg.ts                 ← генерация instanceId + register/heartbeat
│   │   ├── execChannel.ts                 ← приём dev-exec, выполнение, dev-exec-result
│   │   └── domChannel/
│   │       ├── index.ts                   ← HMR-обвязка + initDomChannel
│   │       ├── types.ts                   ← DevDomSender, RawNode, RawSnapshotResult
│   │       ├── interactive.ts             ← isInteractive predicate
│   │       ├── compact.ts                 ← compact DOM snapshot
│   │       └── raw.ts                     ← raw JSON DOM snapshot
│   │
│   └── helpers/
│       └── agentHelpers/
│           ├── index.ts                   ← installAgentHelpers + globalThis регистрация
│           ├── cache.ts                   ← snapshot cache для __agent_click(idx)
│           ├── queries.ts                 ← __agent_snapshot / __agent_findByText
│           ├── interactions.ts            ← __agent_click / setValue / type
│           ├── waits.ts                   ← __agent_wait / __agent_waitFor
│           └── timing.ts                  ← rafFrame / waitMs
│
└── __tests__/
    ├── instanceRegistry.test.ts
    ├── serialize.test.ts
    ├── domChannel.test.ts                 ← снапшот на JSDOM
    └── middleware.test.ts
```

---

## 3. Зоны ответственности

### Сервер (`devBrowserLogs/`)

| Модуль | Отвечает за | Экспортирует |
|---|---|---|
| `index.ts` | Vite plugin factory; регистрирует middleware и WS-слушатели; сбрасывает state при `configureServer` | `default export devBrowserLogs()` |
| `middleware.ts` | Общий роутер, делегирующий по префиксу URL конкретным модулям | `registerMiddleware(server)` |
| `instanceRegistry.ts` | Хранение `Map<InstanceId, InstanceState>`; маркеры `session`/`truncate` per-instance; LRU-вытеснение | `getInstance`, `setInstance`, `listInstances`, `pushToInstance` |
| `manifest.ts` | Отдаёт JSON со схемами tools; формируется из статического описания + runtime-данных (version, port, active instances) | `buildManifest()`, `handleManifest(req, res)` |
| `logs.ts` | Чтение буфера с фильтрами (`level`, `type`, `url`, `text`, `since`, `limit`, `instance`) | `handleLogs(req, res)` |
| `exec.ts` | Принимает код, ставит в очередь, шлёт в WS, ждёт результат по `id`, отдаёт JSON | `handleExec(req, res)`, `enqueueExec(code, timeout)` |
| `dom.ts` | Принимает запрос на снимок DOM, шлёт в WS конкретному инстансу, ждёт результат | `handleDom(req, res)`, `enqueueDomRequest(spec)` |
| `instances.ts` | `GET /__agent/instances` — список активных вкладок | `handleInstances(req, res)` |

### Клиент (`devLogger/`)

| Модуль | Отвечает за |
|---|---|
| `index.ts` | `initDevLogger()` — идемпотентная установка всех перехватчиков и каналов; HMR-dispose |
| `core/lifecycle.ts` | `installed` flag, `trackedListeners`, `dispose` callback; регистрация HMR-dispose |
| `core/ringBuffer.ts` | Per-instance буфер с лимитом + truncate-маркеры |
| `core/dedup.ts` | Сравнение последнего сообщения с новым; `flushDuplicates` / `resetDedupState` |
| `core/serialize.ts` | `safeSerialize(value, {maxSize})` — JSON с cap, защитой cyclic, понятными ошибками для Map/Set/Function |
| `interceptors/*` | Установка и снятие одного конкретного типа перехвата |
| `channels/instanceReg.ts` | Генерация `instanceId`, отправка `dev-instance-register` с метаданными `{url, title}`; обновление при `popstate`/`pushState` |
| `channels/execChannel.ts` | Слушает `dev-exec`, запускает код через `new Function`, шлёт `dev-exec-result`; применяет `serialize` + client timeout |
| `channels/domChannel.ts` | Слушает `dev-dom-request`, собирает DOM (compact или raw), шлёт `dev-dom-response` |
| `helpers/agentHelpers.ts` | Регистрирует `globalThis.__agent_*` — функции для `npx agent run '__agent_clickByText(...)'` через exec |

---

## 4. Контракты протокола

### 4.1 HMR-сообщения (browser ↔ server)

| Event | Направление | Payload |
|---|---|---|
| `dev-instance-register` | browser → server | `{ id: InstanceId, url, title, ts }` |
| `dev-instance-heartbeat` | browser → server | `{ id, ts }` (раз в 30 с) |
| `dev-log` | browser → server | `{ id: InstanceId, ts, level, type, msg, url?, stack?, method?, status?, netUrl?, durationMs? }` |
| `dev-exec` | server → browser | `{ id: RequestId, code }` |
| `dev-exec-result` | browser → server | `{ id: RequestId, fromInstance: InstanceId, ok, value?, error?, ts }` |
| `dev-dom-request` | server → browser | `{ id: RequestId, spec: { format, selector?, focus?, context?, depth?, attrs?, styles?, viewportOnly?, maxSize? } }` |
| `dev-dom-response` | browser → server | `{ id: RequestId, fromInstance: InstanceId, ok, result?, error? }` |

Все сообщения оборачиваются в `Envelope { v: 1, ...payload }` для возможности версионирования.

### 4.2 HTTP-эндпоинты (agent ↔ server)

| Метод | URL | Назначение |
|---|---|---|
| `GET` | `/__agent/manifest` | JSON со схемами tools |
| `GET` | `/__agent/instances` | Список активных вкладок |
| `POST` | `/__agent/eval` | `body: {code, timeout?, instance?}` → выполняет JS, отдаёт `{ok, value, ts}` |
| `GET` | `/__agent/dom?format=compact&...` | Возвращает снапшот DOM (text) |
| `GET` | `/__agent/dom?format=raw&...` | Возвращает JSON-дерево DOM |
| `GET` | `/__dev_logs?level=&type=&url=&text=&since=&limit=&instance=` | NDJSON-стрим логов (legacy) |
| `GET` / `POST` | `/__dev_exec?code=&timeout=&id=&instance=` | Legacy exec-эндпоинт |

### 4.3 Схема манифеста (пример)

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

## 5. Потоки данных (как работают ключевые сценарии)

### 5.1 Захват console.error (самое частое)

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

### 5.2 Multi-instance: две вкладки

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

### 5.3 Eval JS в браузере

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

### 5.4 Compact DOM snapshot

```
[Agent]                                                        [Browser]
GET /__agent/dom?format=compact&focus=5&context=3              
   │
   ▼
dom.ts: enqueueDomRequest(spec)
   id = crypto.randomUUID()
   pendingDom.set(id, resolver)
   server.ws.send({event:'dev-dom-request', data:{id, spec}})
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

### 5.5 Сырой DOM (для анимаций)

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

### 5.6 Хелпер `__agent_clickByText` (v-model-safe)

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

### 5.7 Lifecycle (HMR dispose)

При изменении `devLogger/index.ts` или любого его зависимого файла Vite делает HMR dispose:

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

## 6. Сквозные правила

| Что | Где реализовано | Правило |
|---|---|---|
| **HMR-only канал** | `core/lifecycle.ts`, `channels/*` | Браузер шлёт ТОЛЬКО через `import.meta.hot.send`. Сервер шлёт ТОЛЬКО через `server.ws.send`. |
| **Instance isolation** | `instanceRegistry.ts`, все envelope-сообщения | Каждое сообщение содержит `instanceId`; пишется/читается только в свой буфер. |
| **System markers** | `core/ringBuffer.ts`, `logs.ts` | `session` и `truncate` проходят сквозь все фильтры (`isSystem` shortcut). |
| **Размер ответа** | `core/serialize.ts`, `domChannel.ts` | JSON cap 100 KB (eval), 500 KB (raw DOM); при превышении — `truncated:true` + preview. |
| **Exec timeout** | `channels/execChannel.ts`, `exec.ts` | 5s на клиенте + 10s на сервере (overridable через `?timeout=`). |
| **Дедуп** | `core/dedup.ts` | Два подряд идентичных сообщения склеиваются; счётчик в маркере. |
| **HMR-dispose корректность** | `index.ts`, `lifecycle.ts` | Каждый перехватчик имеет пару «установить/снять»; `trackedListeners` реестр для `window`-слушателей. |
| **Скрытность в Network** | Контракт — только WS | В браузерной Network-вкладке видно только Vite HMR WebSocket. Никаких дополнительных запросов. |

---

## 7. Типичный цикл работы агента

```
1. Agent в начале сессии читает AGENTS.md (там плагин дописал ссылку на /__agent/manifest).
2. GET /__agent/manifest            → получает список tools со схемами.
3. GET /__agent/instances           → видит, какие вкладки подключены.
4. POST /__agent/eval {code:"await __agent_snapshot()"}    → видит структуру страницы.
5. POST /__agent/eval {code:"await __agent_clickByText('Войти')"}    → взаимодействует.
6. GET /__dev_logs?level=error&limit=20&instance=a1        → разбирает упавшее.
7. GET /__agent/dom?format=raw&selector=.modal&styles=computed    → расследует анимационный баг.
8. POST /__agent/eval {code:"await __agent_waitFor('Спасибо', 5000)"}   → ждёт результат.
```

---

## 8. Что не входит в целевую архитектуру

| Что | Почему |
|---|---|
| Standalone-режим без Vite | Агент не управляет браузером; светит HTTP. |
| Channel Server (browser → Claude Code) | MCP stdio запрещён. |
| File-bridge (`.pilot/pending-js.txt`) | HMR WS достаточно. |
| Триггерный DOM snapshot (массив с интервалом) | Отложен (см. §8.13 анализа). |
| CLI-обёртка | Агент работает curl-ом напрямую. |
| Element Inspector | Phase 3, опционально. |
| Подписки (browser → agent) «сообщи, когда появится элемент» | Не входит в Phase 1–2; возможно позже через долгий poll на `/__dev_logs?since=…`. |

---

## 9. Эволюция файлов (как текущий код превратится в целевой)

| Сейчас | После Phase 0 | После Phase 1 | После Phase 2 |
|---|---|---|---|
| `devBrowserLogs.ts` (один файл, 249 строк) | разбит на `devBrowserLogs/{index,middleware,exec,logs}.ts` | + `manifest.ts`, `instances.ts`, `instanceRegistry.ts` | + `dom.ts` |
| `devLogger/index.ts` | без изменений | + регистрация `instanceReg` в lifecycle | + регистрация `domChannel`, `agentHelpers` |
| `devLogger/execChannel.ts` | без изменений | использует `safeSerialize` + `AbortSignal.timeout` | + поддержка `__agent_*` helpers через `globalThis` |
| `devLogger/constants.ts` | + новые пути `/__agent/*` | без изменений | без изменений |
| `devLogger/types.ts` | + `InstanceId`, `ManifestTool`, `AgentEnvelope` | без изменений | + `DomSpec`, `DomResponse` |
| `devLogger/core.ts` | разбит на `core/{ringBuffer,dedup,lifecycle,serialize}` | + `serialize.ts` с cap и timeout | без изменений |

---

## 10. Резюме

- **Один канал** (HMR WS) для всего browser↔server трафика.
- **Один registry** (`Map<InstanceId, InstanceState>`) разруливает много вкладок.
- **Один manifest** (`/__agent/manifest`) описывает все tools с JSON-schema — для агентов без MCP.
- **Два формата DOM** (compact для экономии токенов, raw для отладки анимаций) — ортогональны, выбираются параметром `format`.
- **Один набор хелперов** (`__agent_*`) — v-model-safe обёртки над нативным DOM.
- **Старые эндпоинты** (`/__dev_logs`, `/__dev_exec`) живут параллельно как backward-compat.
- **Phase 3** (Element Inspector, Alt+Click) добавляется отдельно и не ломает ничего из вышеописанного.

---

## 11. Что нужно для публикации в npm

План ниже описывает переход от in-tree кода к публичному npm-пакету. Можно выполнять инкрементально: сначала рефакторинг (Phase 0–2), потом публикация.

### 11.1 Решения, которые нужно принять заранее

| Вопрос | Варианты | Рекомендация |
|---|---|---|
| **Имя пакета** | `vite-plugin-pilot` (занят), `@scope/vite-plugin-pilot`, `vite-agent-bridge`, `@org/agent-bridge` | `vite-agent-bridge` (описывает суть, не занят) или scoped-вариант для приватности |
| **Лицензия** | MIT, Apache-2.0 | MIT — стандарт для devtool'ов |
| **Module format** | ESM only, ESM + CJS | ESM only (Vite ≥5 уже ESM-only); CJS избыточен |
| **Node version** | `>=16`, `>=18`, `>=20` | `>=18` (совпадает с peer dep Vite ≥5) |
| **TS declarations** | bundled (`exports.types`), separate file, generated | bundled через `tsup` — проще для потребителя |
| **Scope** | public, private (org-scoped) | зависит от того, готовы ли поддерживать извне |

### 11.2 Переструктуризация кода

Текущее дерево (`devBrowserLogs.ts` + `devLogger/` в корне) не годится для npm — нет точки входа, нет разделения public/private API.

```
vite-agent-bridge/
├── package.json
├── tsconfig.json                 ← уже есть, расширить
├── tsconfig.build.json           ← для эмита .d.ts
├── README.md
├── LICENSE
├── CHANGELOG.md
│
├── src/
│   ├── index.ts                  ← public entry: export pilot()
│   ├── types.ts                  ← public types (PilotOptions, InstanceId, …)
│   ├── constants.ts              ← internal: endpoint paths
│   │
│   ├── server/                   ← бывший devBrowserLogs/
│   │   ├── index.ts              ← plugin factory
│   │   ├── manifest.ts
│   │   ├── exec.ts
│   │   ├── dom.ts
│   │   ├── logs.ts
│   │   ├── instances.ts
│   │   ├── instanceRegistry.ts
│   │   └── middleware.ts
│   │
│   └── client/                   ← бывший devLogger/
│       ├── index.ts
│       ├── core/{ringBuffer,dedup,lifecycle,serialize}.ts
│       ├── interceptors/{console,network,globalErrors,vue}.ts
│       ├── channels/{instanceReg,execChannel,domChannel}.ts
│       └── helpers/agentHelpers.ts
│
├── __tests__/                    ← vitest
│
├── playground/                   ← демо-проект (Vue, React, vanilla)
│
└── .github/workflows/ci.yml
```

**Public API (`src/index.ts`):**
```ts
export { pilot } from './server';
export type {
    PilotOptions,
    ManifestTool,
    InstanceId,
    LogPayload,
    DomSpec,
    DomResponse,
} from './types';
```

**Internal API:** всё под `src/server/*` и `src/client/*` — не экспортируется, помечено `/* @internal */`.

### 11.3 Сборка и типы

**Инструмент:** [`tsup`](https://tsup.kitlib.dev/) (или `unbuild`) — минимальная конфигурация, ESM + .d.ts из коробки.

```json
// package.json
{
  "type": "module",
  "main": "./dist/index.js",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": ["dist", "README.md", "LICENSE"],
  "scripts": {
    "build": "tsup",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "lint": "eslint src __tests__",
    "prepublishOnly": "npm run lint && npm run typecheck && npm run test && npm run build"
  },
  "peerDependencies": {
    "vite": ">=5"
  },
  "devDependencies": {
    "vite": "^5.0.0",
    "typescript": "^5.5.0",
    "tsup": "^8.0.0",
    "vitest": "^2.0.0",
    "eslint": "^9.0.0"
  },
  "engines": {
    "node": ">=18"
  }
}
```

**Что важно:**
- **`"type": "module"`** — иначе Vite ≥5 не подхватит плагин.
- **`"files": ["dist"]`** — публикуется только `dist/`, исходники остаются в репо для разработки.
- **`prepublishOnly`** — npm по умолчанию запускает перед `npm publish`, гарантирует что в `dist/` свежая сборка.
- **`peerDependencies.vite`** — НЕ `dependencies`, иначе получим две версии Vite в проекте.

### 11.4 Качество перед публикацией

| Что | Минимум | Идеал |
|---|---|---|
| **Unit-тесты** | `serialize`, `instanceRegistry`, `domChannel` (на JSDOM) | + `middleware`, + контрактные тесты на формат манифеста |
| **E2E-тесты** | один сценарий `pnpm dev → curl /__agent/manifest → curl /__dev_logs` в `playground/` | Vitest + `@vitest/browser` или Playwright |
| **CI** | GitHub Actions: lint + typecheck + test + build на Node 18, 20, 22 | + matrix по Vite 5/6/7 |
| **Type check** | `tsc --noEmit` без ошибок | + `tsc --strict` без `any` в public API |
| **Lint** | ESLint с `eslint-config-vite` или `@typescript-eslint/recommended` | + Prettier |
| **Coverage** | не замеряем | ≥70% для `core/*` и `server/*` |
| **Bundle size** | не замеряем | `dist/index.js` ≤ 30 KB (server) + `dist/client.js` ≤ 50 KB (инжектится в HTML) |

### 11.5 Документация

| Файл | Содержание |
|---|---|
| `README.md` | Что это, quick start (5 строк), options, примеры curl, линки на ARCHITECTURE.md / REFACTORING_PLAN.md, badge (npm version, CI, license) |
| `CHANGELOG.md` | Conventional Commits → auto-gen через `release-please` или вручную; semver |
| `LICENSE` | MIT текст |
| `CONTRIBUTING.md` (опц.) | dev setup, PR process |
| `SECURITY.md` (опц.) | как сообщать об уязвимостях |
| Playground | живой пример, который CI может развернуть |

**Минимальный README должен содержать:**
1. Что делает (1 абзац).
2. Quick start: `pnpm add -D vite-agent-bridge` + `pilot()` в `vite.config.ts` + `initDevLogger()` в `main.ts`.
3. Что плагин активен только в dev (`process.env.NODE_ENV !== 'production'`).
4. Список эндпоинтов с примерами.
5. Что **нет** в пакете (Element Inspector, standalone) — чтобы не вводить в заблуждение.
6. Лицензия, ссылка на issues.

### 11.6 Процесс публикации

**Один раз:**
1. `npm login` (или через CI secret).
2. `npm owner add` для соавторов.
3. Включить 2FA на аккаунте (npm требует для publish).

**Каждый релиз:**
1. `git checkout main && git pull`.
2. Обновить версию: `npm version patch|minor|major` (создаёт git tag).
3. `npm run build` (или положиться на `prepublishOnly`).
4. `npm publish --dry-run` — проверка что в tarball попадёт только нужное.
5. `npm publish --access public` (для scoped-пакета).
6. `git push --follow-tags`.
7. Создать GitHub Release с changelog.

**Через CI (рекомендуется):**
- workflow `.github/workflows/release.yml`: триггер на push тега `v*.*.*` → `npm ci && npm run build && npm publish --provenance --access public` (npm trusted publishing через OIDC — без токенов).

### 11.7 Чего НЕ делать

| Что | Почему |
|---|---|
| **Публиковать исходники напрямую без сборки** | Не сможем контролировать API surface, типы будут кривые, tree-shaking не сработает. |
| **Делать CJS-сборку «на всякий случай»** | Vite ≥5 — ESM-only; CJS только увеличит bundle и surface для багов. |
| **Класть `vite` в `dependencies`** | Получим дубликат Vite в проекте пользователя, два экземпляра `configureServer`, конфликты плагинов. |
| **Публиковать `playground/`** | Увеличивает tarball, не нужно пользователю. `files: ["dist"]` это автоматически исключит. |
| **Делать `peerDependencies` optional без нужды** | `magic-string` нужен только в Phase 3; пока не добавляем в peer — это снизит DX (пользователь не понимает, надо ставить или нет). |
| **Релизить сразу 1.0.0** | Начинаем с `0.1.0` — публичный API ещё не стабилизирован; semver-правило «0.y.z — anything goes». |

### 11.8 Что ещё учесть в долгую

- **Trusted publishing через GitHub Actions OIDC** — избавляет от долгоживущих npm-токенов.
- **Renovate / Dependabot** — автоматические обновления peer-deps (Vite 6 → 7).
- **Versioning policy:** пока `<1.0.0` — minor = breaking change, после `1.0.0` — semver strict.
- **Deprecation flow:** если придётся переименовать пакет — `npm deprecate` старого + redirect в README нового.
- **Provenance attestations** — `npm publish --provenance` создаёт SLSA-подпись, повышает доверие в экосистеме.
- **Минимальный CI cache** — `~/.npm` и `node_modules/.cache` для скорости.

### 11.9 Оценка трудозатрат

| Этап | Время (дни) | Зависимости |
|---|---|---|
| 11.1 Решения по имени/лицензии/скоупу | 0.5 | бизнес-решение |
| 11.2 Переструктуризация кода в `src/{server,client}` | 1 | поверх Phase 0 из REFACTORING_PLAN |
| 11.3 package.json + tsup + первая сборка | 0.5 | — |
| 11.4 Тесты + CI workflow | 2 | базовые unit-тесты Phase 1 |
| 11.5 README + CHANGELOG + LICENSE | 1 | — |
| 11.6 Первый `npm publish --dry-run` + ревью tarball | 0.5 | — |
| 11.7 Настройка trusted publishing / CI release | 0.5 | — |
| **Итого** | **~6 дней** | поверх Phase 0–2 |

### 11.10 Итого: чеклист «готово к первой публикации»

- [ ] Код перенесён в `src/{server,client,index.ts,types.ts}`
- [ ] `package.json` с `type: "module"`, `exports`, `files`, `peerDependencies.vite`, `engines.node>=18`
- [ ] `tsup` собирает ESM + `.d.ts`
- [ ] `npm run typecheck && npm run lint && npm run test` зелёные
- [ ] `npm run build && npm run prepublishOnly` отрабатывает
- [ ] `npm pack --dry-run` показывает только `dist/`, `README.md`, `LICENSE`
- [ ] README с quick start, списком эндпоинтов, лицензией
- [ ] CI workflow на push/PR: lint + typecheck + test + build
- [ ] GitHub Release flow (либо ручной, либо через `release-please`)
- [ ] Решено: имя пакета, лицензия, scope, лицензионные header'ы в исходниках

