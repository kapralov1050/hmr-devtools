export interface LogPayload {
    /** ISO-временная метка записи лога (генерируется в `createLog`) */
    ts: string;
    /** Уровень лога: `log`, `info`, `warn`, `error` */
    level: string;
    /** Категория источника: `console`, `error`, `unhandledrejection`, `resource`, `network`, `vue:error`, `vue:warn`, `session`, `truncate` */
    type: string;
    /** Текстовое сообщение (форматированные аргументы, обрезается до `maxArgLen`) */
    msg: string;
    /** URL страницы, на которой сработал перехватчик */
    url: string;
    /** Стек вызова (опционально, для Error) */
    stack?: string | undefined;
    /** HTTP-метод запроса (опционально, для network) */
    method?: string | undefined;
    /** HTTP-статус ответа (опционально, для network) */
    status?: number | undefined;
    /** URL сетевого запроса (опционально, для network) */
    netUrl?: string | undefined;
    /** Длительность запроса в мс (опционально, для network) */
    durationMs?: number | undefined;
}

/** Уникальный идентификатор инстанса (вкладки) браузера. */
export type InstanceId = string;

/** Состояние инстанса на сервере (для multi-instance поддержки в Phase 1). */
export interface InstanceState {
    id: InstanceId;
    url: string;
    title: string;
    /** ISO-временная метка последнего heartbeat/лога. */
    lastSeen: string;
}

/** Описание инструмента в манифесте (`/__agent/manifest`). */
export interface ManifestTool {
    name: string;
    description: string;
    endpoint: string;
    method?: string;
    input_schema: Record<string, unknown>;
}

/** Полный манифест плагина, отдаваемый агентам. */
export interface Manifest {
    v: 1;
    name: string;
    version: string;
    port?: number;
    system_hint: string;
    capabilities: string[];
    tools: ManifestTool[];
    examples: string[];
}

/** Спека запроса на DOM-снапшот (для `dev-dom-request` HMR-сообщения). */
export interface DomSpec {
    format: 'compact' | 'raw';
    selector?: string;
    focus?: number;
    context?: number;
    depth?: number;
    attrs?: 'all' | 'interactive' | 'none';
    styles?: 'none' | 'inline' | 'computed';
    viewportOnly?: boolean;
    maxSize?: number;
}

/** Результат DOM-снапшота, отправляемый браузером серверу. */
export interface DomResponse {
    ok: boolean;
    /** Compact-формат: текстовое представление дерева. */
    value?: string;
    /** Raw-формат: JSON-дерево. */
    tree?: unknown;
    truncated?: boolean;
    error?: string;
    sizeBytes?: number;
}

/** Envelope для всех HMR-сообщений (поле `v` фиксирует версию протокола). */
export interface AgentEnvelope<T = unknown> {
    v: 1;
    payload: T;
}
