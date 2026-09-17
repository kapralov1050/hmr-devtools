/**
 * Общие константы dev-логгера.
 * Импортируется и клиентскими модулями (через @/), и Vite-плагином (через относительный путь).
 *
 * Legacy-эндпоинты (`/__dev_logs`, `/__dev_exec`) сохранены для backward-compat.
 * Новые агенты должны использовать `/__agent/*` и читать манифест.
 */
export const endpoint = '/__dev_logs';
export const execEndpoint = '/__dev_exec';

export const agentManifestEndpoint = '/__agent/manifest';
export const agentInstancesEndpoint = '/__agent/instances';
export const agentEvalEndpoint = '/__agent/eval';
export const agentDomEndpoint = '/__agent/dom';

/** HMR event names (browser ↔ server через Vite HMR WebSocket). */
export const hmrEventLog = 'dev-log';
export const hmrEventExec = 'dev-exec';
export const hmrEventExecResult = 'dev-exec-result';
export const hmrEventInstanceRegister = 'dev-instance-register';
export const hmrEventInstanceHeartbeat = 'dev-instance-heartbeat';
export const hmrEventDomRequest = 'dev-dom-request';
export const hmrEventDomResponse = 'dev-dom-response';

/** Defaults. */
export const defaultExecTimeoutMs = 5000;
export const defaultServerWaitTimeoutMs = 10000;
export const defaultMaxSerializedBytes = 100 * 1024;
export const defaultMaxEntries = 5000;
export const defaultInstanceHeartbeatMs = 30_000;