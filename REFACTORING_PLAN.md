# Vite Agent Bridge — план рефакторинга

> Основание: сравнительный анализ `vite-plugin-pilot` ([VITE_PLUGIN_PILOT_ANALYSIS.md](./VITE_PLUGIN_PILOT_ANALYSIS.md)).
> Цель: заимствовать сильные стороны pilot'а, не ломая нашу HMR-only архитектуру и инфраструктурные ограничения (без MCP, без внешних CLI).

---

## 1. Принципы рефакторинга (что НЕ трогаем)

| Что | Почему |
|---|---|
| **Только HMR WebSocket** для browser→server и server→browser | Pilot светит `/__pilot/*` HTTP — нарушает наш принцип «не светиться в Network». |
| **Только Vite dev-режим** | Standalone-режим отвергнут: агент не управляет браузером, дебажить prod не наш сценарий. |
| **Серверные фильтры** `level/type/url/text/since/limit` | Значительно лучше pilot'овских CLI-фильтров. Не трогать. |
| **Дедуп + ring-buffer + truncate-маркеры** | Лучше чем у pilot. Не трогать. |
| **In-tree код без npm-пакета** | Не вводим внешние зависимости сверх того, что уже есть. |
| **Манифест как runtime-endpoint** | Не заменяем на статический `SKILL.md`. |

---

## 2. Целевая архитектура (после рефакторинга)

```
┌─────────────────┐  HTTP (curl)   ┌────────────────────┐   HMR WS    ┌─────────────┐
│   AI Agent      │ ─────────────► │  Vite Dev Server   │ ──────────► │   Browser   │
│  (in container) │                │  (devBrowserLogs)  │             │ (devLogger) │
│                 │ ◄───────────── │                    │ ◄────────── │             │
└─────────────────┘                └────────────────────┘             └─────────────┘
        │                                    │
        │ GET /__agent/manifest              │ ring buffer per instance
        │ POST /__agent/eval                 │ instanceId registry
        │ GET  /__agent/dom                  │ truncate markers
        │ GET  /__dev_logs  (legacy)         │
        │ POST /__dev_exec  (legacy)        │
```

**Новые эндпоинты** (`/__agent/*` namespace для discovery через манифест):
- `GET /__agent/manifest` — JSON со схемами tools и capabilities.
- `POST /__agent/eval` — выполнение JS (новое имя для `/__dev_exec`).
- `GET /__agent/dom` — снапшот DOM (compact или raw по параметрам).
- `GET /__agent/instances` — список активных вкладок.

**Старые эндпоинты** (`/__dev_*`) сохраняются как backward-compat алиасы на период миграции.

---

## 3. Поэтапный план

### Phase 0 — Подготовка (низкий риск, чистая инфраструктура)

**Цель:** заложить модульную структуру, чтобы фазы 1–3 не превратились в один большой PR.

| # | Что | Файлы |
|---|---|---|
| 0.1 | Вынести `devBrowserLogs.ts` (249 строк) в директорию `devBrowserLogs/{index,manifest,instances,dom,exec,logs}.ts` | переименование + разделение middleware |
| 0.2 | Вынести константы эндпоинтов в `devLogger/constants.ts` (там уже `/__dev_logs` и `/__dev_exec`, добавляем `/__agent/*`) | `devLogger/constants.ts` |
| 0.3 | Завести `devLogger/types.ts` расширения: `InstanceId`, `ManifestTool`, `ManifestCapability` | `devLogger/types.ts` |
| 0.4 | Покрыть текущее поведение smoke-тестами (fetch `GET /__dev_logs?limit=10`, `POST /__dev_exec` с `document.title`) | `__tests__/` |

**Критерий готовности:** поведение HTTP-эндпоинтов и HMR-канала идентично до-рефакторинговому. Внутренние импорты перестроены.

---

### Phase 1 — Quick wins (высокая ценность, низкая цена)

**Цель:** закрыть 80% разрыва функциональности за счёт манифеста, multi-instance и cap'а на сериализацию.

#### 1.1 Манифест (`GET /__agent/manifest`)

| Что | Детали |
|---|---|
| Где | `devBrowserLogs/manifest.ts` (server), `devLogger/types.ts` (типы) |
| Эндпоинт | `GET /__agent/manifest` |
| Ответ | JSON: `name`, `version`, `capabilities[]`, `tools[]` со `input_schema`, `examples[]`, `system_hint` |
| Инструменты в первой версии | `browser_eval`, `browser_dom`, `browser_logs`, `browser_instances` |
| AGENTS.md | Плагин дописывает строку `Dev tooling: GET http://localhost:<port>/__agent/manifest` через merge-маркер (см. README §2.4) |

#### 1.2 Multi-instance через `instanceId`

| Что | Детали |
|---|---|
| Где клиент | `devLogger/execChannel.ts` + новый `devLogger/instance.ts` |
| Где сервер | `devBrowserLogs/instances.ts` с `Map<InstanceId, InstanceState>` |
| Изменения клиента | Генерация `instanceId = ${Date.now()}-${Math.random().toString(36).slice(2,8)}` при первой инициализации; прокидывание в каждое `dev-log` и `dev-exec-result` сообщение; отправка `instance.register` с метаданными `{url, title}` при старте + при смене URL (через `popstate`/`pushState`) |
| Изменения сервера | `Map<InstanceId, { buffer: LogPayload[], lastSeen: ISO, meta: {url, title} }>`; `?instance=` query-параметр; `?instance=` обязателен при наличии >1 инстанса, иначе ошибка «multiple instances, specify ?instance=» |
| Маркер `truncate` | Остаётся per-instance (не общий) |
| `GET /__agent/instances` | Возвращает массив `{id, type, url, title, lastSeen}` |

**Backward-compat:** при единственном инстансе сервер ведёт себя как сейчас — `?instance=` опционален.

#### 1.3 Сериализация: cap + client timeout + осмысленные ошибки

| Что | Детали |
|---|---|
| Где | `devLogger/execChannel.ts` (клиент), `devLogger/core.ts` или новый `devLogger/serialize.ts` |
| Max size | 100 KB на сериализованный `value`; при превышении `{ok: true, truncated: true, preview: <первые N символов>, sizeBytes}` |
| Exec timeout на клиенте | `Promise.race` с `AbortSignal.timeout(5000)`; при таймауте `{ok: false, error: 'Execution timed out after 5000ms'}` |
| Cyclic references | `try { JSON.stringify(v, replacer, 2) } catch { return {ok: false, error: 'Cyclic structure', hint: '...'} }` |
| Non-serializable types | `replacer` ловит `Map`/`Set`/`Function` → `{ok: false, error: 'Non-serializable: Map', hint: 'use Array.from(map.entries())'}` |

#### 1.4 `nopage` флаг в ответе `/__dev_exec`

| Что | Детали |
|---|---|
| Где | `devBrowserLogs.ts` (server) |
| Что делает | При `?nopage=1` (по умолчанию `0`, в будущем `1` — когда появится snapshot) — не прикладывать snapshot к ответу. Сейчас snapshot отсутствует — флаг зарезервирован. |

**Критерий готовности Phase 1:**
- `GET /__agent/manifest` возвращает актуальный JSON со всеми инструментами.
- 2+ вкладки работают изолированно: логи не перетираются, `?instance=` фильтрует корректно.
- `eval('while(true){}')` падает с осмысленной ошибкой за 5 с, браузер не виснет.
- `eval('document.body.outerHTML')` возвращает `truncated:true` если >100 KB.
- В `AGENTS.md` дописана строка через merge-маркер при первом запуске плагина.

---

### Phase 2 — Compact snapshot + хелперы + сырой DOM

**Цель:** дать агенту «глаза» в страницу без перерасхода токенов.

#### 2.1 Compact snapshot (формат pilot'а)

| Что | Детали |
|---|---|
| Где сервер | `devBrowserLogs/dom.ts` (mode `compact`) |
| Где клиент | `devLogger/dom.ts` (сборка дерева) |
| Эндпоинт | `GET /__agent/dom?format=compact&selector=...&focus=#N&context=4` |
| Формат | `tag#idx[val=V][check=…][type:T][ph=P][href:…][disabled] text` (один узел на строку, ~80 строк на страницу) |
| Focus | `?focus=3` — выделяет узел маркером `→` и показывает ±`?context=` строк вокруг, остальное свёрнуто в `·` |
| `idx` | Сквозной индекс по видимым интерактивным элементам, передаётся хелперам из §2.2 |

#### 2.2 Хелперы `__agent_*` (копия pilot'овских `__pilot_*` под нашим неймспейсом)

| Что | Детали |
|---|---|
| Где | `devLogger/agentHelpers.ts` (клиент, инжектится как часть HMR-клиента) |
| Префикс | `__agent_` (не `__pilot_` — наш плагин) |
| Минимальный набор v1 | `__agent_clickByText(text, nth?)`, `__agent_click(idx)`, `__agent_typeByPlaceholder(ph, value)`, `__agent_setValueByPlaceholder(ph, value, nth?)`, `__agent_waitFor(text, timeoutMs?)`, `__agent_wait(ms)`, `__agent_findByText(text)`, `__agent_snapshot()` |
| v-model совместимость | `type`/`setValue` триггерят и `input`, и `change` события; после изменения — `await new Promise(r => requestAnimationFrame(() => r(null)))` для v-model |
| Регистрация | `globalThis.__agent_*` (не через `window.__agent` — colon в имени недопустим) |

#### 2.3 Сырой DOM (ортогонально compact)

| Что | Детали |
|---|---|
| Эндпоинт | `GET /__agent/dom?format=raw&selector=...&depth=10&attrs=all&styles=computed&maxSize=500000` |
| Параметры | `format=raw|compact` (default `compact`), `selector`, `depth` (default 5), `attrs=all|interactive|none`, `styles=none|inline|computed`, `viewportOnly=true|false`, `maxSize` (default 500 KB) |
| Возврат | JSON `{selector, matches, tree: [{tag, attrs, computed?, children}]}` |
| Триггерный режим | **Не реализуем** (см. §8.13 анализа). |

**Критерий готовности Phase 2:**
- `GET /__agent/dom?format=compact` возвращает ≤80 строк для типовой страницы.
- `GET /__agent/dom?format=compact&focus=5` показывает таргет с `→` и сворачивает дальние области.
- `GET /__agent/dom?format=raw&selector=.modal&styles=computed` возвращает `transform`, `opacity`, `animation-name`.
- Агент может выполнить `return await __agent_clickByText('Войти')` через `__dev_exec` и получить результат клика + компактный snapshot.

---

### Phase 3 — Element Inspector (опционально)

**Цель:** дать пользователю возможность Alt+Click-ом сгенерировать готовый AI-промпт.

| Что | Детали |
|---|---|
| Source locator | `transform`-хук Vite + `magic-string` (peer-deps уже есть у Vite) → `data-v-agent-file` / `data-v-agent-line` |
| Inspector | `devLogger/elementInspector.ts` — Alt+Click overlay, Alt+Scroll parent/child, Alt+RightClick → `code -g file:line` |
| Промпт-генератор | `devLogger/promptGenerator.ts` — ElementInfo → текстовый блок с компонентом, источником, размерами, текстом |
| Эндпоинт | `POST /__agent/inspect` (принимает `ElementInfo`, отдаёт готовый промпт-текст) |
| Приоритет | **Низкий.** Зависит от UX-сценария «человек+агент в реальном времени». Если команда работает автономно — отложить. |

**Критерий готовности Phase 3:** Alt+Click → плавающая панель с готовым промптом + кликабельный jump-to-source.

---

## 4. Что НЕ делаем (явно отклонено)

| Что | Причина |
|---|---|
| Standalone-режим + Tampermonkey | Агент не управляет браузером, плюс светит HTTP. |
| Channel Server (browser → Claude Code) | MCP stdio запрещён. |
| `SKILL.md` / `SETUP.md` | MCP/skill-регистрация недоступна; манифест покрывает ту же задачу. |
| File-bridge канал (`.pilot/pending-js.txt`) | HMR WS достаточно. |
| Клиентский rate-limit / батч | Штормов console.log в проекте пока не наблюдается. Добавим точечно при необходимости. |
| Триггерный режим для DOM snapshot | Отложен по явной просьбе. |
| CLI-обёртка (`npx agent run …`) | Агент работает curl-ом. Опционально позже. |

---

## 5. Стратегия миграции (backward compatibility)

**Принцип:** ничего из существующего не ломаем. Старые эндпоинты живут параллельно с новыми минимум одну фазу.

| Шаг | Действие |
|---|---|
| Phase 0 | Никаких изменений в API. Только рефакторинг кода. |
| Phase 1.1 | `GET /__agent/manifest` — новый эндпоинт. `/__dev_logs` и `/__dev_exec` работают как раньше. |
| Phase 1.2 | `?instance=` поддерживается, но опционален при единственном инстансе — старое поведение сохранено. |
| Phase 1.3 | Изменение формата ошибок сериализации. Существующий успешный путь не затронут. |
| Phase 2 | `/__agent/dom` — новый. Старые эндпоинты без изменений. Агент может переключаться постепенно. |
| Phase 3 | Только дополнения (новые модули, новые эндпоинты). |
| Будущее (отдельное решение) | После стабилизации — пометить `/__dev_*` как deprecated, не удалять ещё один релиз. |

---

## 6. Открытые вопросы

| Вопрос | Кто решает | Блокер для какой фазы |
|---|---|---|
| Имя неймспейса: `__agent_*` или `__bridge_*`? (мы выбрали `__agent_*` как черновик) | Команда | Phase 2.2 |
| Имя эндпоинтов: `/__agent/*` или `/__bridge/*`? (выбрали `/__agent/*`) | Команда | Phase 1.1 |
| Применять ли `__agent_*` хелперы через `globalThis` или через явный модуль, импортируемый агентом? | Техлид | Phase 2.2 |
| Каков лимит `maxSize` для raw DOM: 100 KB, 500 KB, 1 MB? | По опыту использования | Phase 2.3 |
| Хранить ли instance meta `{url, title}` на диске (`./.dev-agent/instances/<id>.json`) для восстановления после перезапуска сервера? | Техлид | Phase 1.2 |

---

## 7. Порядок реализации (резюме)

```
Phase 0  ──► Phase 1.1 ──► Phase 1.2 ──► Phase 1.3 ──► Phase 2.1 ──► Phase 2.2 ──► Phase 2.3 ──► Phase 3
prep       manifest       multi-inst    serialize      compact       helpers       raw-dom       inspector
(0.5d)     (1d)           (1.5d)        (0.5d)         (2d)          (1.5d)        (1d)          (2d, опц.)
```

Суммарно без Phase 3: ~8 рабочих дней. Phase 3 — отдельно, по запросу.

---

## 8. Метрики успеха

| Метрика | Как измеряем |
|---|---|
| Агент успешно читает логи без знания внутреннего устройства плагина | `GET /__agent/manifest` → агент использует `browser_logs` tool по имени из манифеста |
| Много вкладок не ломают логи | `?instance=` фильтрует, логи не перетираются |
| Большие ответы `eval` не взрывают контекст | `eval('document.body.outerHTML')` → `{truncated:true, sizeBytes: 104857, preview: ...}` |
| Анимационные баги дебажатся | `GET /__agent/dom?format=raw&selector=.modal&styles=computed` показывает `transform: matrix(…)` |
| Агент взаимодействует с v-model | `__agent_typeByPlaceholder('Email', 'a@b.c')` через `/__dev_exec` корректно заполняет Vue input |
