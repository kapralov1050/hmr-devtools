/**
 * Vite-плагин devBrowserLogs.
 *
 * Перехватывает логи и ошибки в браузере через HMR WebSocket
 * (не светится в Network-вкладке DevTools) и отдаёт их агенту по HTTP.
 *
 * Активен только в dev-режиме (вызывающий код проверяет `process.env.NODE_ENV`).
 */
import type {Plugin, ViteDevServer} from 'vite';
import {buildAgentsMdSnippet, patchAgentsMd} from './agentsMd';
import {pushToBuffer} from './logs';
import {registerMiddleware} from './middleware';
import type {DevLogsContext} from './types';

/** Создаёт серверный контекст с пустым instances registry и maps. */
export function createContext(): DevLogsContext {
    const ctx: DevLogsContext = {
        instances: new Map(),
        execResults: new Map(),
        pendingExec: new Map(),
        domResults: new Map(),
        pendingDom: new Map(),
        push(instanceId, entry): void {
            pushToBuffer(ctx, instanceId, entry);
        },
    };

    return ctx;
}

/** Best-effort патч AGENTS.md в корне проекта (не должен ломать старт плагина). */
function scheduleAgentsMdPatch(server: ViteDevServer): void {
    const root = server.config.root;
    const port = server.config.server.port ?? 5173;
    const snippet = buildAgentsMdSnippet(port);

    setImmediate(() => {
        patchAgentsMd(root, snippet).catch((err: unknown) => {
            const message = err instanceof Error ? err.message : String(err);
            process.stderr.write(`[vite-agent-bridge] AGENTS.md patch failed: ${message}\n`);
        });
    });
}

/** Vite-плагин factory. */
export default function devBrowserLogs(): Plugin {
    return {
        name: 'dev-browser-logs',
        configureServer(server) {
            const ctx = createContext();

            registerMiddleware(server, ctx);
            scheduleAgentsMdPatch(server);
        },
    };
}
