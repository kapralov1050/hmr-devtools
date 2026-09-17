/**
 * Серверная обработка `GET /__dev_logs` (legacy) с фильтрами.
 * Приём логов из HMR WebSocket (`dev-log`) и push в ring buffer.
 */
import type http from 'node:http';
import type {LogPayload} from '../devLogger/types';
import {defaultMaxEntries} from '../devLogger/constants';
import type {DevLogsContext} from './types';

/** Системные маркеры (session/truncate) проходят сквозь все фильтры. */
function isSystem(entry: LogPayload): boolean {
    return entry.type === 'session' || entry.type === 'truncate';
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function parseLogEntry(raw: unknown): LogPayload | null {
    if (!isRecord(raw)) {
        return null;
    }

    if (typeof raw.ts !== 'string' || typeof raw.level !== 'string') {
        return null;
    }

    const str = (v: unknown): string => (typeof v === 'string' ? v : '');

    return {
        ts: raw.ts,
        level: raw.level,
        type: str(raw.type),
        msg: stringifyMsg(raw.msg),
        url: str(raw.url),
        stack: typeof raw.stack === 'string' ? raw.stack : undefined,
        method: typeof raw.method === 'string' ? raw.method : undefined,
        status: typeof raw.status === 'number' ? raw.status : undefined,
        netUrl: typeof raw.netUrl === 'string' ? raw.netUrl : undefined,
        durationMs: typeof raw.durationMs === 'number' ? raw.durationMs : undefined,
    };
}

function stringifyMsg(value: unknown): string {
    if (typeof value === 'string') {
        return value;
    }

    if (value === null || value === undefined) {
        return '';
    }

    try {
        return JSON.stringify(value) ?? stringifyFallback(value);
    } catch {
        return stringifyFallback(value);
    }
}

/** Fallback when JSON.stringify throws (cyclic) or returns undefined (undefined). */
function stringifyFallback(value: unknown): string {
    return String(value);
}

/**
 * Push в ring buffer. При переполнении — сбрасывает половину и кладёт
 * системный маркер `truncate` для информирования читающего агента.
 */
export function pushToBuffer(ctx: DevLogsContext, entry: LogPayload): void {
    ctx.buffer.push(entry);

    if (ctx.buffer.length > defaultMaxEntries) {
        const dropCount = Math.floor(ctx.buffer.length / 2);
        ctx.buffer.splice(0, dropCount);
        ctx.buffer.push({
            ts: new Date().toISOString(),
            level: 'info',
            type: 'truncate',
            msg: `Ring buffer trimmed ${dropCount} entries`,
            url: '',
        });
    }
}

/** Обработчик `dev-log` HMR-события: парсит и пушит в buffer. */
export function handleDevLog(data: unknown, ctx: DevLogsContext): void {
    const entry = parseLogEntry(data);

    if (entry) {
        pushToBuffer(ctx, entry);
    }
}

/** HTTP-обработчик `GET /__dev_logs` с фильтрами level/type/url/text/since/limit. */
export function handleLogs(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    ctx: DevLogsContext,
): void {
    try {
        const parsed = new URL(req.url ?? '/', 'http://localhost');
        const level = parsed.searchParams.get('level');
        const type = parsed.searchParams.get('type');
        const urlFilter = parsed.searchParams.get('url');
        const textFilter = parsed.searchParams.get('text');
        const sinceFilter = parsed.searchParams.get('since');
        const limitParam = parsed.searchParams.get('limit');
        const parsedLimit = limitParam ? Number.parseInt(limitParam, 10) : 0;
        const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 0;

        let entries = ctx.buffer.slice();

        // Системные маркеры (session/truncate) не фильтруются по level
        if (level) {
            entries = entries.filter((e) => e.level === level || isSystem(e));
        }

        if (type) {
            entries = entries.filter((e) => e.type === type || isSystem(e));
        }

        if (urlFilter) {
            entries = entries.filter(
                (e) => e.url.includes(urlFilter) || (e.netUrl?.includes(urlFilter) ?? false) || isSystem(e),
            );
        }

        if (textFilter) {
            const lower = textFilter.toLowerCase();
            entries = entries.filter(
                (e) =>
                    e.msg.toLowerCase().includes(lower) ||
                    (e.stack ?? '').toLowerCase().includes(lower) ||
                    (e.netUrl ?? '').toLowerCase().includes(lower),
            );
        }

        if (sinceFilter) {
            const sinceMs = Date.parse(sinceFilter);
            entries = entries.filter((e) => (Number.isNaN(sinceMs) ? true : Date.parse(e.ts) >= sinceMs));
        }

        if (limit > 0) {
            entries = entries.slice(-limit);
        }

        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.end(entries.map((e) => JSON.stringify(e)).join('\n') + (entries.length > 0 ? '\n' : ''));
    } catch {
        res.statusCode = 500;
        res.end('Internal error');
    }
}