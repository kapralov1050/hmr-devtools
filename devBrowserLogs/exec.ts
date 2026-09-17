/**
 * Серверная обработка `/__dev_exec` (legacy).
 * Получение JS-кода от агента, отправка в браузер через HMR-событие `dev-exec`,
 * ожидание `dev-exec-result`, возврат JSON с результатом.
 *
 * Также обрабатывает входящий `dev-exec-result` от браузера: складывает в
 * LRU-карту execResults и резолвит ожидающий promise.
 */
import type http from 'node:http';
import type {ViteDevServer} from 'vite';
import {defaultServerWaitTimeoutMs, hmrEventExec} from '../devLogger/constants';
import {maxExecResults, type DevExecResult, type DevLogsContext} from './types';

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function writeJson(res: http.ServerResponse, status: number, body: unknown): void {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(body));
}

function newRequestId(): string {
    if (typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }

    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Принимает и парсит входящее WS-сообщение `dev-exec-result` от браузера. */
export function handleExecResult(data: unknown, ctx: DevLogsContext): void {
    if (!isRecord(data) || typeof data.id !== 'string') {
        return;
    }

    const id = data.id;
    const entry: DevExecResult = {
        ok: data.ok === true,
        value: typeof data.value === 'string' ? data.value : undefined,
        error: typeof data.error === 'string' ? data.error : undefined,
        ts: new Date().toISOString(),
    };

    ctx.execResults.set(id, entry);

    if (ctx.execResults.size > maxExecResults) {
        const oldest = ctx.execResults.keys().next().value;

        if (oldest !== undefined) {
            ctx.execResults.delete(oldest);
        }
    }

    const resolver = ctx.pendingExec.get(id);

    if (resolver) {
        ctx.pendingExec.delete(id);
        resolver(entry);
    }
}

/** HTTP-обработчик `GET/POST /__dev_exec`: код в `?code=`, `?id=`, `?timeout=`. */
export function handleExec(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    server: ViteDevServer,
    ctx: DevLogsContext,
): void {
    try {
        const parsed = new URL(req.url ?? '/', 'http://localhost');

        const idParam = parsed.searchParams.get('id');

        if (idParam) {
            const entry = ctx.execResults.get(idParam);

            if (entry) {
                writeJson(res, 200, entry);
            } else {
                res.statusCode = 404;
                res.end('Not found');
            }

            return;
        }

        const code = parsed.searchParams.get('code');

        if (!code) {
            res.statusCode = 400;
            res.end('Missing ?code=');

            return;
        }

        const id = newRequestId();
        const timeoutMs = Number.parseInt(parsed.searchParams.get('timeout') ?? '', 10);
        const timeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : defaultServerWaitTimeoutMs;

        ctx.pendingExec.set(id, (entry) => {
            clearTimeout(timer);
            writeJson(res, 200, entry);
        });

        const timer = setTimeout(() => {
            const r = ctx.pendingExec.get(id);

            if (r) {
                ctx.pendingExec.delete(id);
                writeJson(res, 504, {ok: false, error: `No browser client responded within ${timeout}ms`});
            }
        }, timeout);

        server.ws.send({type: 'custom', event: hmrEventExec, data: {id, code}});
    } catch {
        res.statusCode = 500;
        res.end('Internal error');
    }
}