# Правила для субагентов

## Документация (обязательна к прочтению перед началом работы)
- README.md — что умеет решение, как пользоваться, протоколы, потоки данных
- NPM_PUBLISH_PLAN.md — план подготовки к npm-публикации (если задача связана с публикацией)

## Структура (src/{server,client}/)
- src/server/* — Vite plugin (Node-side, читает файлы как `src/server/manifest.ts`)
- src/client/* — browser-side (dev only, инжектируется в страницу)
- src/index.ts — public entry; экспортирует `pilot()` default + `initDevLogger` named
- src/types.ts, src/constants.ts — public type/constants barrels

## Инструменты
- Перед возвратом выполни `npm run verify` (typecheck + lint + test + coverage + build).
- Если verify падает — чинь. Не возвращай «заработает позже».
- Тесты пиши в `__tests__/**/*.test.ts`. Vitest, jsdom.

## Границы
- Не трогай файлы вне своего блока.
- Не пиши код в `dist/`, `node_modules/`, `.kilo/`, `coverage/`.
- Не коммить и не пушь без явной просьбы.
- В отчёте: какие файлы создал/изменил, какие команды запускал, полный вывод verify.
