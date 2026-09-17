/**
 * Серверная обработка `GET /__dev_logs` (legacy) с фильтрами и multi-instance.
 * Приём логов из HMR WebSocket (`dev-log`) и push в per-instance ring buffer.
 */
import type http from 'node:http';
import type {InstanceId, LogPayload} from '../devLogger/types';
import {defaultMaxEntries} from '../devLogger/constants';
import {ensureInstance} from './instanceRegistry';
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
 * Push в ring buffer конкретного инстанса (lazily создаёт entry).
 * При переполнении — сбрасывает половину и кладёт системный маркер `truncate`.
 */
export function pushToBuffer(ctx: DevLogsContext, instanceId: InstanceId, entry: LogPayload): void {
    const inst = ensureInstance(ctx, instanceId);
    inst.buffer.push(entry);

    if (inst.buffer.length > defaultMaxEntries) {
        const dropCount = Math.floor(inst.buffer.length / 2);
        inst.buffer.splice(0, dropCount);
        inst.buffer.push({
            ts: new Date().toISOString(),
            level: 'info',
            type: 'truncate',
            msg: `Ring buffer trimmed ${dropCount} entries (instance ${instanceId})`,
            url: '',
        });
    }
}

function writeJson(res: http.ServerResponse, status: number, body: unknown): void {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(body));
}

function listInstanceIds(ctx: DevLogsContext): InstanceId[] {
    return Array.from(ctx.instances.keys()).sort();
}

/**
 * Обработчик `dev-log` HMR-события: парсит envelope `{id, payload}` или legacy payload,
 * маршрутизирует в буфер нужного инстанса.
 *
 * Fallback: legacy payload (без envelope) → 'default' инстанс.
 */
export function handleDevLog(data: unknown, ctx: DevLogsContext): void {
    if (!isRecord(data)) {
        return;
    }

    let instanceId: InstanceId;
    let rawEntry: unknown;

    if (typeof data.id === 'string' && isRecord(data.payload)) {
        instanceId = data.id;
        rawEntry = data.payload;
    } else if (typeof data.ts === 'string' && typeof data.level === 'string') {
        instanceId = 'default';
        rawEntry = data;
    } else {
        return;
    }

    const entry = parseLogEntry(rawEntry);
    if (entry) {
        pushToBuffer(ctx, instanceId, entry);
    }
}

/**
 * HTTP-обработчик `GET /__dev_logs` с фильтрами level/type/url/text/since/limit/instance.
 *
 * Multi-instance:
 * - `?instance=<id>` — отдаёт буфер конкретного инстанса (404 если неизвестен).
 * - без `?instance=` и 0 инстансов — пустой NDJSON.
 * - без `?instance=` и ровно 1 инстанс — back-compat: отдаём его буфер.
 * - без `?instance=` и >1 инстансов — 400 + список доступных.
 */
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
        const instanceFilter = parsed.searchParams.get('instance');

        let entries: LogPayload[];

        if (instanceFilter !== null) {
            const inst = ctx.instances.get(instanceFilter);
            if (!inst) {
                writeJson(res, 404, {
                    error: `Unknown instance '${instanceFilter}'`,
                    instances: listInstanceIds(ctx),
                });
                return;
            }
            entries = inst.buffer.slice();
        } else {
            const instanceCount = ctx.instances.size;
            if (instanceCount === 0) {
                entries = [];
            } else if (instanceCount === 1) {
                const first = ctx.instances.values().next().value;
                entries = first ? first.buffer.slice() : [];
            } else {
                writeJson(res, 400, {
                    error: 'multiple instances, specify ?instance=',
                    instances: listInstanceIds(ctx),
                });
                return;
            }
        }

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
