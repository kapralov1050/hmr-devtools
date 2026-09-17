/**
 * Общий router серверной части: подключает HTTP-эндпоинты и WS-слушатели
 * на `server.middlewares` / `server.ws`, делегируя обработку конкретным модулям.
 */
import type http from 'node:http';
import type {ViteDevServer} from 'vite';
import {endpoint, execEndpoint, hmrEventExecResult, hmrEventLog} from '../devLogger/constants';
import {handleDevLog, handleLogs} from './logs';
import {handleExec, handleExecResult} from './exec';
import type {DevLogsContext} from './types';

/** Регистрирует middleware и WS-слушатели плагина на переданном сервере. */
export function registerMiddleware(server: ViteDevServer, ctx: DevLogsContext): void {
    server.ws.on(hmrEventLog, (data) => handleDevLog(data, ctx));
    server.ws.on(hmrEventExecResult, (data) => handleExecResult(data, ctx));

    server.middlewares.use(endpoint, (req: http.IncomingMessage, res: http.ServerResponse) => {
        handleLogs(req, res, ctx);
    });

    server.middlewares.use(execEndpoint, (req: http.IncomingMessage, res: http.ServerResponse) => {
        handleExec(req, res, server, ctx);
    });
}