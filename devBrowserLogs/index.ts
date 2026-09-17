/**
 * Vite-плагин devBrowserLogs.
 *
 * Перехватывает логи и ошибки в браузере через HMR WebSocket
 * (не светится в Network-вкладке DevTools) и отдаёт их агенту по HTTP.
 *
 * Активен только в dev-режиме (вызывающий код проверяет `process.env.NODE_ENV`).
 */
import type {Plugin} from 'vite';
import {pushToBuffer} from './logs';
import {registerMiddleware} from './middleware';
import type {DevLogsContext} from './types';

/** Создаёт серверный контекст с пустым buffer'ом и maps. */
export function createContext(): DevLogsContext {
    const ctx: DevLogsContext = {
        buffer: [],
        execResults: new Map(),
        pendingExec: new Map(),
        push(entry) {
            pushToBuffer(ctx, entry);
        },
    };

    return ctx;
}

/** Vite-плагин factory. */
export default function devBrowserLogs(): Plugin {
    return {
        name: 'dev-browser-logs',
        configureServer(server) {
            const ctx = createContext();

            // Стартовая метка сессии — попадает в /__dev_logs первой записью.
            ctx.push({
                ts: new Date().toISOString(),
                level: 'info',
                type: 'session',
                msg: '--- Dev session started ---',
                url: '',
            });

            registerMiddleware(server, ctx);
        },
    };
}