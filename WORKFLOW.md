# Workflow автономной разработки Vite Agent Bridge

> Цель: реализовать рефакторинг ([REFACTORING_PLAN.md](./REFACTORING_PLAN.md)) и архитектуру ([ARCHITECTURE.md](./ARCHITECTURE.md)) силами субагентов с жёсткими quality gates между блоками.

---

## 0. Принципы

1. **Блоки атомарны и верифицируемы.** Один блок = одна логическая правка (новый модуль / переименование / добавление одной функции). После блока можно прогнать `typecheck + lint + test` и получить зелёный/красный.
2. **Каждый блок проходит 4 стадии:** план → реализация → независимое ревью → тесты. Никакая стадия не перескакивает.
3. **Субагент не трогает то, что не в его блоке.** В промпте явно перечислены файлы, за которые он отвечает.
4. **Quality gates запускаются всегда**, даже если «вроде бы мелкая правка». Битый typecheck не пропускается ни под каким предлогом.
5. **Главный агент не пишет код напрямую**, кроме мелочей вроде todo-обновлений. Всё через `task`-инструмент.

---

## 1. Pre-flight (один раз перед стартом)

Прежде чем фанаутить реализацию, нужно настроить инструментарий. Иначе субагенты будут гадать, какой package manager, какие команды, где тесты.

### 1.1 Базовый `package.json` со скриптами

```jsonc
{
  "name": "hmr-devtools",
  "private": true,
  "type": "module",
  "scripts": {
    "typecheck": "tsc --noEmit",
    "lint": "eslint . --max-warnings=0",
    "lint:fix": "eslint . --fix",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "verify": "npm run typecheck && npm run lint && npm run test"
  }
}
```

`npm run verify` — единая точка входа для quality gate. Субагент ОБЯЗАН вызвать её перед возвратом.

### 1.2 Конфиги

| Файл | Что | Минимум |
|---|---|---|
| `tsconfig.json` | TS-конфиг для исходников | `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`, `target: ES2022`, `module: ESNext`, `moduleResolution: bundler` |
| `eslint.config.js` | ESLint v9 flat-config | `@typescript-eslint/recommended-type-checked`, `eslint-config-prettier` (отключает конфликтующие правила) |
| `.prettierrc` | форматирование | `printWidth: 120`, `singleQuote: true`, `trailingComma: 'all'`, `semi: true` |
| `vitest.config.ts` | тесты | `environment: 'jsdom'`, `include: ['__tests__/**/*.test.ts']` |
| `.gitignore` | игнор | `dist`, `coverage`, `node_modules`, `.DS_Store` |

### 1.3 AGENTS.md (правила для всех субагентов)

```
# Правила для субагентов

- Перед началом работы прочитай: REFACTORING_PLAN.md, ARCHITECTURE.md.
- Не трогай файлы вне своего блока.
- Перед возвратом выполни `npm run verify` (typecheck + lint + test).
- Если verify падает — чинь. Не возвращай «заработает позже».
- Не пиши код в `dist/`, `node_modules/`, `.kilo/`.
- Не коммить и не пушь без явной просьбы.
- Используй `readonly: true` для файлов, которые только читаешь.
- В отчёте: какие файлы создал/изменил, какие команды запускал, полный вывод verify.
```

### 1.4 Рабочая директория субагентов

Все блоки делаются в изолированной worktree (через `.kilo/worktrees/` или git worktree), чтобы:
- главный агент видел diff, не перетирая свою работу;
- можно было параллелить блоки без конфликтов;
- каждый блок можно было откатить отдельно.

Если репо ещё не git — `git init && git add -A && git commit` перед стартом.

---

## 2. Декомпозиция на блоки

Каждый блок = одна `task` для субагента. Размер блока: от 30 мин до 2 ч работы человека.

**Пример для Phase 0 (REFACTORING_PLAN):**

| # | Блок | Подзадачи |
|---|---|---|
| B0.1 | Разбить `devBrowserLogs.ts` на `devBrowserLogs/{index,middleware,exec,logs}.ts` | создать директорию; переместить код по зонам; проверить импорты |
| B0.2 | Расширить `devLogger/constants.ts` новыми путями `/__agent/*` | добавить константы; обновить типы |
| B0.3 | Расширить `devLogger/types.ts`: `InstanceId`, `ManifestTool`, `ManifestCapability` | новые типы |
| B0.4 | Smoke-тесты: `GET /__dev_logs?limit=10`, `POST /__dev_exec` с `document.title` | vitest + supertest-fetch |

**Пример для Phase 1 (по REFACTORING_PLAN):**

| # | Блок | Подзадачи |
|---|---|---|
| B1.1 | `devBrowserLogs/manifest.ts` + handler `GET /__agent/manifest` | schema, регистрация, smoke-тест |
| B1.2 | Multi-instance: `instanceReg.ts` (клиент) + `instanceRegistry.ts` (сервер) + `Map` storage | HMR-сообщения, фильтр `?instance=` |
| B1.3 | `devBrowserLogs/instances.ts` + `GET /__agent/instances` | перечисление активных |
| B1.4 | `devLogger/core/serialize.ts`: cap, client timeout, обработка cyclic/Map/Set | безопасная сериализация |
| B1.5 | AGENTS.md patch через merge-маркер | file-watch на старте плагина |

---

## 3. Жизненный цикл одного блока

```
┌─────────────────────────────────────────────────────────────────────┐
│  1. PLAN                                                            │
│     Главный агент пишет промпт для implementer-субагента:           │
│       - какие файлы создать/изменить                                │
│       - ссылка на секцию REFACTORING_PLAN.md / ARCHITECTURE.md      │
│       - критерии приёмки (что должно работать после блока)          │
│       - формат отчёта                                               │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  2. IMPLEMENT                                                       │
│     subagent_type: "general"                                        │
│     Читает плановую документацию, делает изменения.                 │
│     Запускает `npm run verify`.                                     │
│     Возвращает: список изменённых файлов + вывод verify.            │
│                                                                     │
│     Если verify падает — фиксит сам и перезапускает.                │
│     Если не может починить — возвращает явный FAIL.                 │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  3. REVIEW (другой субагент, отдельная task)                        │
│     subagent_type: "general"                                        │
│     Получает: список изменённых файлов, описание блока.             │
│     Делает (без редактирования):                                    │
│       - читает diff файлов                                          │
│       - проверяет соответствие плану                                │
│       - проверяет code style (сравни с соседними файлами)           │
│       - ищет ошибки (typos, off-by-one, ресурсные утечки)           │
│       - проверяет, не сломал ли смежные блоки                       │
│     Возвращает: VERDICT (PASS / NEEDS_FIX с конкретным списком).    │
│                                                                     │
│     КРИТЕРИИ VERDICT (см. §4).                                     │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  4. TEST                                                             │
│     subagent_type: "general"                                        │
│     Пишет/обновляет тесты для нового блока.                         │
│     Запускает `npm run verify` + `npm run test:coverage`.           │
│     Возвращает: список тестов + coverage новых строк.               │
│                                                                     │
│     Минимум: 1 happy-path + 1 edge-case на каждую новую функцию.   │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  5. INTEGRATE                                                       │
│     Главный агент:                                                  │
│       - читает все три отчёта                                       │
│       - если PASS — мержит worktree блока в main worktree           │
│       - обновляет todo                                              │
│       - переходит к следующему блоку                                │
│       - если NEEDS_FIX — формулирует правки, прогоняет IMPLEMENT    │
│         повторно (только этот блок, не следующий)                   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 4. Чеклист ревью (для стадии REVIEW)

`general`-субагент проверяет по этому списку. Вердикт — структурированно.

### 4.1 Соответствие плану

| Вопрос | Где смотреть |
|---|---|
| Реализованы ВСЕ пункты из критериев приёмки блока? | промпт блока |
| Нет ли расхождений с ARCHITECTURE.md §N (ссылка из промпта)? | doc |
| Нет ли расхождений с REFACTORING_PLAN.md Phase M.Block K? | doc |
| Публичный API соответствует заявленному (имена экспортов, сигнатуры)? | `src/index.ts` + `types.ts` |

### 4.2 Корректность кода

| Вопрос | Где смотреть |
|---|---|
| TypeScript strict проходит? | `npm run typecheck` |
| Нет `any`, `as unknown as`, `@ts-ignore` без обоснования? | grep по diff |
| Все async-функции либо явно try/catch, либо проброшены? | diff |
| Нет утечек: `addEventListener` с парным `removeEventListener`? | diff |
| HMR-dispose корректен (восстанавливает оригиналы)? | `lifecycle.ts` |
| `import.meta.hot` проверяется перед использованием? | channels/* |
| Сериализация не теряет ошибки (try/catch + осмысленный return)? | `serialize.ts` |
| Таймауты проставлены там, где могут зависнуть (exec, ws send)? | exec.ts, channels |
| Размеры ограничены (cap на JSON, maxEntries на ring buffer)? | core/serialize.ts, core/ringBuffer.ts |
| `instanceId` пробрасывается во все WS-сообщения? | channels/* |

### 4.3 Code style

| Правило | Проверка |
|---|---|
| Именование kebab-case для файлов, camelCase для переменных, PascalCase для типов | diff |
| Файлы ≤ 250 строк (если больше — предложить разбить) | wc -l |
| Импорты: внешние → внутренние → относительные, разделены пустой строкой | diff |
| Нет закомментированного кода | grep `//.*[;{}]` |
| Логи на русском (как в существующем коде) | diff |
| Сообщения ошибок содержат hint (как в pilot) | serialize.ts |
| Magic strings вынесены в `constants.ts` | grep `'dev-'` |
| Нет `console.log` для отладки (только через devLogger) | grep `console\.log` |
| prettier проходит | `npm run format:check` |
| eslint проходит без warnings | `npm run lint` |

### 4.4 Смежные эффекты

| Вопрос | Где смотреть |
|---|---|
| Не сломан ли контракт с `/__dev_logs`, `/__dev_exec`? | manual curl |
| Не изменился ли формат HMR-сообщений без миграции клиента? | channels/*, server/* |
| Новые эндпоинты не конфликтуют с существующими? | constants.ts |
| Тесты не стали flaky (порядок, тайминги)? | vitest output |

### 4.5 Формат вердикта

```markdown
## Review: блок B1.1 (manifest)

**Verdict:** PASS | NEEDS_FIX | BLOCKED

### Соответствие плану
- ✅ Реализован GET /__agent/manifest
- ✅ Возвращает schema со всеми tools
- ❌ Отсутствует поле `system_hint` (есть в ARCHITECTURE.md §4.3)

### Корректность
- ✅ typecheck clean
- ⚠️ `any` в `manifest.ts:42` (`as any` для совместимости с Vite version)
- ✅ HMR-dispose корректен

### Style
- ❌ Файл 312 строк — превышает лимит 250
- ✅ Prettier чистый
- ✅ ESLint без warnings

### Смежные эффекты
- ✅ /__dev_logs, /__dev_exec не затронуты
- ✅ Формат HMR не менялся

### Необходимые правки
1. Добавить `system_hint` в buildManifest()
2. Убрать `as any`, использовать `unknown` + narrowing
3. Разбить `manifest.ts` на `manifest/{schema,builder}.ts`

### Файлы для re-review после правок
- src/server/manifest/schema.ts (new)
- src/server/manifest/builder.ts (new)
- src/server/manifest.ts (delete)
```

---

## 5. Промпт-шаблоны

### 5.1 Промпт IMPLEMENTER'у

```
ЗАДАЧА: Реализовать блок B{phase}.{block} из REFACTORING_PLAN.md.

КОНТЕКСТ:
- Проект: /Users/.../hmr devtools
- Документация: REFACTORING_PLAN.md §..., ARCHITECTURE.md §...
- Перед началом прочитай эти секции.

ФАЙЛЫ, КОТОРЫЕ ТЫ МОЖЕШЬ ТРОГАТЬ:
- src/server/manifest.ts (создать)
- src/server/middleware.ts (добавить маршрут)
- src/server/index.ts (зарегистрировать)
- src/server/types.ts (добавить типы)
- __tests__/manifest.test.ts (создать)

ФАЙЛЫ, КОТОРЫЕ ТЫ НЕ ТРОГАЕШЬ:
- src/client/**
- package.json
- README.md, REFACTORING_PLAN.md, ARCHITECTURE.md

КРИТЕРИИ ПРИЁМКИ:
1. GET /__agent/manifest возвращает JSON со схемами всех 4 tools
2. manifest доступен через `import { buildManifest } from './server/manifest'`
3. Smoke-тест в __tests__/manifest.test.ts проходит
4. `npm run verify` зелёный

ЗАПРЕЩЕНО:
- Менять API других модулей
- Добавлять зависимости в package.json
- Коммитить

ОБЯЗАТЕЛЬНО ПЕРЕД ВОЗВРАТОМ:
1. `npm run verify` — должен быть зелёным, вывод приложи
2. `curl http://localhost:5173/__agent/manifest | jq .` (если можешь запустить dev) — JSON приложи
3. Краткое summary: какие файлы создал, какие тесты добавил, output verify

ФОРМАТ ОТЧЁТА:
## Files changed
- <path>: <what>
## Tests
- <test name>: PASS/FAIL
## verify output
<полный вывод npm run verify>
## Manual checks (если делал)
<curl output>
## Known issues
<если есть>
```

### 5.2 Промпт REVIEWER'у

```
ЗАДАЧА: Ревью блока B{phase}.{block}.

КОНТЕКСТ:
- Проект: /Users/.../hmr devtools
- Реализация субагента-имплементора: см. его отчёт (приложен ниже)
- Оригинальный план: REFACTORING_PLAN.md §..., ARCHITECTURE.md §...
- Чеклист ревью: WORKFLOW.md §4

ЧТО ПРОВЕРИТЬ:
1. Соответствие плану (все ли критерии приёмки выполнены)
2. Корректность кода (см. чеклист §4.2)
3. Code style (см. §4.3)
4. Смежные эффекты (см. §4.4)

ЗАПРЕЩЕНО:
- Редактировать файлы (только чтение)
- Запускать verify — это делал имплементор

ОБЯЗАТЕЛЬНО:
- Прочитать каждый файл из отчёта имплементора ПОЛНОСТЬЮ (не только diff)
- Запустить `git diff main -- <file>` для каждого файла
- Сверить сигнатуры экспортов с ARCHITECTURE.md §...

ФОРМАТ ОТЧЁТА:
## Verdict: PASS | NEEDS_FIX | BLOCKED
<по чеклисту §4.5>
```

### 5.3 Промпт TESTER'у

```
ЗАДАЧА: Написать/обновить тесты для блока B{phase}.{block}.

КОНТЕКСТ:
- Реализация: <пути к файлам>
- План: REFACTORING_PLAN.md §...
- Что уже покрыто: <если есть тесты, перечислить>

ТРЕБОВАНИЯ К ТЕСТАМ:
- Минимум 1 happy-path + 1 edge-case на каждую новую функцию
- Использовать vitest (describe/it/expect), не jest
- Для клиентских модулей — `environment: 'jsdom'` (уже в vitest.config)
- Для HTTP — `node:http` + `node:assert`, не supertest (избегаем лишних deps)
- Тесты НЕ должны ходить в сеть — мокай server.ws

ПЕРЕД ВОЗВРАТОМ:
1. `npm run test` — все тесты зелёные
2. `npm run verify` — всё зелёное
3. Coverage новых строк ≥ 70% (покажи через `npm run test:coverage`)

ФОРМАТ ОТЧЁТА:
## Tests added
- <test file>: <test name>
## Coverage
- new lines: <%>
## verify output
<полный>
```

---

## 6. Параллелизация

Не все блоки зависят друг от друга. Независимые можно запускать параллельно через `task` с `background: true`.

**Пример для Phase 1:**

```
Параллельная группа 1 (нет зависимостей):
  - B1.1 manifest.ts
  - B1.4 serialize.ts

Параллельная группа 2 (зависит от B1.1, B1.4):
  - B1.2 instanceReg + instanceRegistry
  - B1.3 instances.ts (зависит от B1.2 — сериализует InstanceState)

Последовательно:
  - B1.5 AGENTS.md patch (зависит от всех)
```

Главный агент ждёт завершения группы (`task` без `background`), потом запускает следующую.

---

## 7. Эскалация

| Ситуация | Действие |
|---|---|
| Имплементор не может пройти verify после 3 попыток | Эскалация на главного агента; либо simplify задачи, либо pair-review |
| Reviewer дал NEEDS_FIX с ≥5 пунктов | Новый блок IMPLEMENT с явным списком правок; НЕ переходить к следующему блоку |
| Тесты флакают (pass/fail нестабильно) | Блок блокируется, нужен фикс — флаки запрещены в main |
| Блок ломает смежный (не учёл при реализации) | Откатить worktree, переделать с учётом зависимостей |
| Субагент проигнорировал запрет и тронул чужие файлы | Откатить worktree, новый промпт с явным «только эти файлы» |

---

## 8. Что НЕ делать через субагентов

| Что | Почему | Кто делает |
|---|---|---|
| Принимать архитектурные решения | Субагент не знает контекст всего проекта | Главный агент / пользователь |
| Делить большую фичу на блоки | Требует понимания зависимостей и приоритетов | Главный агент (по REFACTORING_PLAN.md) |
| Мержить блоки между worktree | Чувствительная операция с конфликтами | Главный агент |
| Писать плановую документацию | Голос продукта, не реализации | Главный агент |
| Финальное ревью всей фазы (после прохождения всех блоков) | Сквозной взгляд, ловят системные баги | Главный агент через одного субагента с полным контекстом фазы |

---

## 9. Чеклист «фаза готова»

После того как все блоки фазы прошли IMPLEMENT + REVIEW + TEST:

- [ ] Все блоки имеют вердикт PASS от reviewer'а
- [ ] `npm run verify` зелёный на main worktree (после merge всех блоков)
- [ ] Coverage не упал относительно предыдущей фазы
- [ ] Smoke-тест из плана фазы проходит end-to-end (запустить dev-сервер, выполнить сценарий из плана)
- [ ] Документация (README, REFACTORING_PLAN) обновлена — отмечены сделанные пункты
- [ ] Финальный ревью субагентом с полным контекстом фазы прошёл
- [ ] CHANGELOG обновлён (запись по conventional commits)

---

## 10. Команды для главного агента

| Команда | Что делает |
|---|---|
| `kilo` | Текущий интерфейс |
| `git worktree add ../vab-b1.1 -b feat/b1.1-manifest` | Создать worktree под блок |
| `npm run verify` | Quality gate (запускать в каждом worktree) |
| `git -C ../vab-b1.1 diff main` | Diff блока для ревью |
| `git -C ../vab-b1.1 log --oneline -5` | История коммитов блока |

---

## 11. Резюме

| Стадия | Что | Кто |
|---|---|---|
| Plan | декомпозиция на блоки | Главный |
| Implement | код + verify | subagent general |
| Review | соответствие плану + style + ошибки | subagent general (другой) |
| Test | unit + coverage | subagent general |
| Integrate | merge в main, todo, переход дальше | Главный |

**Главный агент не пишет код и не ревьюит сам — он оркестрирует и принимает вердикты.**
