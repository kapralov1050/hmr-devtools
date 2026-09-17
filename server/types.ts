/**
 * Типы и общий контекст серверной части (`devBrowserLogs/`).
 * Импортируется только Node-кодом (Vite-плагином), алиасы `@/*` недоступны —
 * пути к `devLogger` относительные.
 */
import type {DomResponse, InstanceId, InstanceState, LogPayload} from '../client/types';

/** Результат выполнения JS в браузере (сохраняется на сервере до востребования). */
export interface DevExecResult {
    ok: boolean;
    value?: string | undefined;
    error?: string | undefined;
    /** Instance, от которого пришёл результат (для multi-instance, опционально). */
    fromInstance?: InstanceId | undefined;
    ts: string;
}

/** Резолвер для in-flight exec-запроса: вызывается при получении результата от браузера. */
export type PendingExecResolver = (entry: DevExecResult) => void;

/** Резолвер для in-flight DOM-запроса: вызывается при получении результата от браузера. */
export type PendingDomResolver = (entry: DomResponse) => void;

/** Серверное состояние инстанса: расширяет `InstanceState` per-instance ring buffer'ом. */
export interface InstanceEntry extends InstanceState {
    buffer: LogPayload[];
}

/** Серверное состояние, общее для всех эндпоинтов и WS-слушателей. */
export interface DevLogsContext {
    /** Per-instance ring buffer логов (с системными маркерами session/truncate). */
    instances: Map<InstanceId, InstanceEntry>;
    /** LRU-карта последних результатов exec (по id). */
    execResults: Map<string, DevExecResult>;
    /** Открытые ожидания ответа от браузера. */
    pendingExec: Map<string, PendingExecResolver>;
    /** LRU-карта последних результатов dom (по id). */
    domResults: Map<string, DomResponse>;
    /** Открытые ожидания DOM-ответа от браузера. */
    pendingDom: Map<string, PendingDomResolver>;
    /** Push в буфер конкретного инстанса (lazily создаёт entry, если инстанс неизвестен). */
    push(instanceId: InstanceId, entry: LogPayload): void;
}

/** Лимиты, общие для модулей. */
export const maxExecResults = 50;
export const maxDomResults = 50;
