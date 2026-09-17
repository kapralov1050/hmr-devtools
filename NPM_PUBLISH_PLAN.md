# NPM Publish Plan — Vite Agent Bridge

> Цель: перевести Vite Agent Bridge из текущего in-tree состояния в публичный npm-пакет.
> Текущий код полностью готов к публикации (Phase 0–2 завершены, 176 тестов зелёных, coverage gate ≥70%, `npm run verify` проходит).

---

## 1. Текущее состояние

- **Код:** ~3000 строк, разделён на `server/` (Node, Vite plugin) и `client/` (браузер, dev only).
- **Тесты:** 176 passed + 1 todo, `__tests__/**/*.test.ts` (vitest, jsdom).
- **Verify:** `npm run verify` = `typecheck + lint + test + test:coverage`. Зелёный.
- **Coverage:** глобальные thresholds `lines ≥ 70`, `branches ≥ 70`, `functions ≥ 80`, `statements ≥ 70`. Exclude — модули, которые в jsdom не запускаются (см. [README §8](./README.md)).
- **Структура:** уже модульная (`server/{manifest,exec,dom,logs,instances,middleware,instanceRegistry,agentsMd,index,types}.ts`, `client/{core,interceptors,channels,helpers}/…`). Подходит для переноса в `src/{server,client}/` без переписывания.
- **Документация:** [README.md](./README.md) (полный, 12 разделов) + AGENTS.md (правила субагентов).

---

## 2. Решения, которые нужно принять заранее

| Вопрос | Варианты | Рекомендация |
|---|---|---|
| **Имя пакета** | `vite-agent-bridge`, `@scope/vite-agent-bridge`, `@scope/agent-bridge` | `vite-agent-bridge` (описывает суть, не занят). Scoped — если нужна приватность/орг-бренд. |
| **Лицензия** | MIT, Apache-2.0 | MIT — стандарт для devtool'ов. |
| **Module format** | ESM only, ESM + CJS | ESM only (Vite ≥5 уже ESM-only); CJS избыточен. |
| **Node version** | `>=16`, `>=18`, `>=20` | `>=18` (совпадает с peer dep Vite ≥5). |
| **TS declarations** | bundled (`exports.types`), separate file, generated | bundled через `tsup` — проще для потребителя. |
| **Scope** | public, private (org-scoped) | зависит от того, готовы ли поддерживать извне. |
| **Начальная версия** | `0.0.1`, `0.1.0`, `1.0.0` | `0.1.0` — публичный API ещё не стабилизирован; semver-правило «0.y.z — anything goes». |
| **Renovate/Dependabot** | вкл, выкл | вкл — автообновления peer-deps (Vite 6 → 7). |

---

## 3. Что нужно сделать

### 3.1 Переструктуризация в `src/{server,client}/`

Текущее дерево (`server/` + `client/` в корне) не годится для npm — нет public entry, нет разделения public/private API.

```
vite-agent-bridge/
├── package.json
├── tsconfig.json
├── tsconfig.build.json              ← для эмита .d.ts
├── README.md
├── LICENSE
├── CHANGELOG.md
│
├── src/
│   ├── index.ts                     ← public entry: export default devBrowserLogs()
│   ├── types.ts                     ← public types
│   │
│   ├── server/                      ← бывший server/
│   │   ├── index.ts                 ← plugin factory
│   │   ├── manifest.ts
│   │   ├── exec.ts
│   │   ├── dom.ts
│   │   ├── logs.ts
│   │   ├── instances.ts
│   │   ├── instanceRegistry.ts
│   │   ├── middleware.ts
│   │   ├── agentsMd.ts
│   │   └── types.ts
│   │
│   └── client/                      ← бывший client/
│       ├── index.ts
│       ├── constants.ts
│       ├── types.ts
│       ├── core/{ringBuffer,dedup,lifecycle,serialize,...}.ts
│       ├── interceptors/{console,network,globalErrors,vue}.ts
│       ├── channels/{instanceReg,execChannel,domChannel}.ts
│       └── helpers/agentHelpers.ts
│
├── __tests__/                       ← vitest (env: jsdom)
│
└── .github/workflows/
    ├── ci.yml                       ← lint + typecheck + test + build
    └── release.yml                  ← trusted publishing
```

**Public API (`src/index.ts`):**
```ts
export { default as viteAgentBridge } from './server';
export type {
    ManifestTool,
    InstanceId,
    LogPayload,
    DomSpec,
    DomResponse,
} from './types';
```

**Internal API:** всё под `src/server/*` и `src/client/*` — не экспортируется.

### 3.2 `package.json` + tsup сборка

```jsonc
{
  "name": "vite-agent-bridge",
  "version": "0.1.0",
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
    "vitest": "^2.1.0",
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

**tsup конфиг** (минимум, ESM + .d.ts):
```ts
// tsup.config.ts
import { defineConfig } from 'tsup';

export default defineConfig({
    entry: ['src/index.ts'],
    format: ['esm'],
    dts: true,
    clean: true,
    sourcemap: true,
});
```

### 3.3 Тесты + CI

Тесты переезжают в `__tests__/` как есть (`vitest.config.ts` обновляется для `src/__tests__`). CI workflow:

```yaml
# .github/workflows/ci.yml
name: CI
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node: [18, 20, 22]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: ${{ matrix.node }} }
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm run test
      - run: npm run test:coverage
      - run: npm run build
```

### 3.4 README + CHANGELOG + LICENSE

- **README.md** — уже готов (этот проект), перед публикацией переписать на «внешний» стиль: что это, quick start, список эндпоинтов, лицензия, линки. Без ссылок на внутренние `REFACTORING_PLAN.md` / `ARCHITECTURE.md` / `WORKFLOW.md`.
- **CHANGELOG.md** — Conventional Commits → auto-gen через `release-please` или вручную; semver.
- **LICENSE** — MIT текст.

### 3.5 Процесс публикации

**Один раз:**
1. `npm login` (или через CI secret).
2. `npm owner add` для соавторов.
3. Включить 2FA на аккаунте (npm требует для publish).

**Каждый релиз (ручной):**
1. `git checkout main && git pull`.
2. Обновить версию: `npm version patch|minor|major` (создаёт git tag).
3. `npm run build` (или положиться на `prepublishOnly`).
4. `npm publish --dry-run` — проверка что в tarball попадёт только нужное.
5. `npm publish --access public` (для scoped-пакета).
6. `git push --follow-tags`.
7. Создать GitHub Release с changelog.

**Через CI (рекомендуется):**
- `.github/workflows/release.yml`: триггер на push тега `v*.*.*` → `npm ci && npm run build && npm publish --provenance --access public` (npm **trusted publishing через OIDC** — без долгоживущих токенов).

---

## 4. Чего НЕ делать

| Что | Почему |
|---|---|
| **Публиковать исходники напрямую без сборки** | Не сможем контролировать API surface, типы будут кривые, tree-shaking не сработает. |
| **Делать CJS-сборку «на всякий случай»** | Vite ≥5 — ESM-only; CJS только увеличит bundle и surface для багов. |
| **Класть `vite` в `dependencies`** | Получим дубликат Vite в проекте пользователя, два экземпляра `configureServer`, конфликты плагинов. |
| **Публиковать `playground/`** | Увеличивает tarball, не нужно пользователю. `files: ["dist"]` это автоматически исключит. |
| **Делать `peerDependencies` optional без нужды** | `magic-string` нужен только в Phase 3; пока не добавляем в peer — это снизит DX (пользователь не понимает, надо ставить или нет). |
| **Релизить сразу `1.0.0`** | Начинаем с `0.1.0` — публичный API ещё не стабилизирован; semver-правило «0.y.z — anything goes». |
| **Поддерживать Node <18** | Vite ≥5 уже требует ≥18; держать два бранча смысла нет. |

---

## 5. Открытые вопросы для решения

Перенесены из REFACTORING_PLAN §6 — нужно решить до/во время публикации:

| Вопрос | Кто решает | Когда блокирует |
|---|---|---|
| Имя неймспейса: `__agent_*` или `__bridge_*`? (выбрали `__agent_*` как черновик) | Команда | До публикации (API-breaking для пользователей) |
| Лимит `maxSize` для raw DOM: 100 KB, 500 KB, 1 MB? (текущий default — 500 KB) | По опыту использования | Между `0.1.0` и `0.2.0` |
| Persist instance meta `{url, title}` на диске (`./.dev-agent/instances/<id>.json`) для восстановления после перезапуска сервера? | Техлид | Между `0.1.0` и `0.2.0` |
| Добавлять ли `magic-string` в `peerDependencies` уже на `0.1.0` для будущего Element Inspector? | Техлид | До публикации (если да — DX хуже, надо документировать) |

---

## 6. Оценка трудозатрат

| Этап | Время (дни) | Зависимости |
|---|---|---|
| Решения по имени/лицензии/скоупу (см. §2) | 0.5 | бизнес-решение |
| Переструктуризация кода в `src/{server,client}` (см. §3.1) | 1 | поверх текущей модульной структуры |
| `package.json` + tsup + первая сборка (см. §3.2) | 0.5 | — |
| Тесты + CI workflow (см. §3.3) | 2 | базовые unit-тесты уже есть |
| README + CHANGELOG + LICENSE (см. §3.4) | 1 | — |
| Первый `npm publish --dry-run` + ревью tarball | 0.5 | — |
| Настройка trusted publishing / CI release | 0.5 | — |
| **Итого** | **~6 дней** | поверх текущего кода |

---

## 7. Чеклист готовности к первой публикации

- [ ] Принято решение по имени пакета (`vite-agent-bridge` vs scoped)
- [ ] Принято решение по лицензии (рекомендация: MIT)
- [ ] Принято решение по scope (public / private)
- [ ] Код перенесён в `src/{server,client,index.ts,types.ts}`
- [ ] `package.json` с `type: "module"`, `exports`, `files: ["dist"]`, `peerDependencies.vite`, `engines.node>=18`
- [ ] `tsup` собирает ESM + `.d.ts`
- [ ] `npm run typecheck && npm run lint && npm run test && npm run test:coverage` зелёные
- [ ] `npm run build && npm run prepublishOnly` отрабатывает
- [ ] `npm pack --dry-run` показывает только `dist/`, `README.md`, `LICENSE`
- [ ] README переписан на «внешний» стиль (без ссылок на внутренние документы)
- [ ] CHANGELOG.md создан с первой записью
- [ ] LICENSE (MIT) создан
- [ ] CI workflow на push/PR: lint + typecheck + test + coverage + build, matrix по Node 18/20/22
- [ ] Release workflow на push тега `v*.*.*`: trusted publishing через OIDC
- [ ] npm-аккаунт настроен: 2FA включена, owner'ы добавлены
- [ ] Проведён `npm publish --dry-run` с ревью финального tarball
- [ ] Решены открытые вопросы из §5 (как минимум имя неймспейса и `magic-string` в peer deps)