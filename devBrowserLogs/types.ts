/**
 * Типы и общий контекст серверной части (`devBrowserLogs/`).
 * Импортируется только Node-кодом (Vite-плагином), алиасы `@/*` недоступны —
 * пути к `devLogger` относительные.
 */
import type {LogPayload} from '../devLogger/types';

/** Результат выполнения JS в браузере (сохраняется на сервере до востребования). */
export interface DevExecResult {
    ok: boolean;
    value?: string | undefined;
    error?: string | undefined;
    ts: string;
}

/** Резолвер для in-flight exec-запроса: вызывается при получении результата от браузера. */
export type PendingExecResolver = (entry: DevExecResult) => void;

/** Серверное состояние, общее для всех эндпоинтов и WS-слушателей. */
export interface DevLogsContext {
    /** Ring-buffer логов (с системными маркерами session/truncate). */
    buffer: LogPayload[];
    /** LRU-карта последних результатов exec (по id). */
    execResults: Map<string, DevExecResult>;
    /** Открытые ожидания ответа от браузера. */
    pendingExec: Map<string, PendingExecResolver>;
    /** Push в buffer + truncate при переполнении. */
    push(entry: LogPayload): void;
}

/** Лимиты, общие для модулей. */
export const maxExecResults = 50;