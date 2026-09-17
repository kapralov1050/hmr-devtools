/**
 * Общий router серверной части: подключает HTTP-эндпоинты и WS-слушатели
 * на `server.middlewares` / `server.ws`, делегируя обработку конкретным модулям.
 *
 * Multi-instance: периодически запускает prune протухших инстансов.
 */
import type http from 'node:http';
import type {ViteDevServer} from 'vite';
import {
    agentInstancesEndpoint,
    agentManifestEndpoint,
    defaultInstanceHeartbeatMs,
    endpoint,
    execEndpoint,
    hmrEventExecResult,
    hmrEventInstanceHeartbeat,
    hmrEventInstanceRegister,
    hmrEventLog,
} from '../devLogger/constants';
import {handleDevLog, handleLogs} from './logs';
import {handleExec, handleExecResult} from './exec';
import {handleInstances} from './instances';
import {handleManifest} from './manifest';
import {
    handleInstanceHeartbeat,
    handleInstanceRegister,
    pruneStaleInstances,
} from './instanceRegistry';
import type {DevLogsContext} from './types';

/** Регистрирует middleware и WS-слушатели плагина на переданном сервере. */
export function registerMiddleware(server: ViteDevServer, ctx: DevLogsContext): void {
    server.ws.on(hmrEventLog, (data) => handleDevLog(data, ctx));
    server.ws.on(hmrEventExecResult, (data) => handleExecResult(data, ctx));
    server.ws.on(hmrEventInstanceRegister, (data) => handleInstanceRegister(data, ctx));
    server.ws.on(hmrEventInstanceHeartbeat, (data) => handleInstanceHeartbeat(data, ctx));

    server.middlewares.use(endpoint, (req: http.IncomingMessage, res: http.ServerResponse) => {
        handleLogs(req, res, ctx);
    });

    server.middlewares.use(execEndpoint, (req: http.IncomingMessage, res: http.ServerResponse) => {
        handleExec(req, res, server, ctx);
    });

    server.middlewares.use(agentManifestEndpoint, (req: http.IncomingMessage, res: http.ServerResponse) => {
        handleManifest(req, res, ctx);
    });

    server.middlewares.use(agentInstancesEndpoint, (req: http.IncomingMessage, res: http.ServerResponse) => {
        handleInstances(req, res, ctx);
    });

    // Периодический prune протухших инстансов. Используем heartbeatMs как интервал:
    // чаще чем maxAgeMs (3 heartbeat'а), но не слишком часто.
    setInterval(() => pruneStaleInstances(ctx), defaultInstanceHeartbeatMs);
}
