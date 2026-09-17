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
    stack?: string;
    /** HTTP-метод запроса (опционально, для network) */
    method?: string;
    /** HTTP-статус ответа (опционально, для network) */
    status?: number;
    /** URL сетевого запроса (опционально, для network) */
    netUrl?: string;
    /** Длительность запроса в мс (опционально, для network) */
    durationMs?: number;
}
