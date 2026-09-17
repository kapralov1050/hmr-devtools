/**
 * Public constants barrel пакета `vite-agent-bridge`.
 *
 * Эндпоинты `/__agent/*` — основной публичный API для агентов.
 * Legacy-эндпоинты `/__dev_*` сохранены для backward-compat.
 */
export {
    agentManifestEndpoint,
    agentInstancesEndpoint,
    agentEvalEndpoint,
    agentDomEndpoint,
    defaultExecTimeoutMs,
    defaultServerWaitTimeoutMs,
    defaultMaxSerializedBytes,
    defaultMaxEntries,
    defaultInstanceHeartbeatMs,
} from './client/constants';
