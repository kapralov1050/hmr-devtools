/**
 * Серверная обработка `GET /__agent/dom`.
 *
 * Принимает параметры `format`, `selector`, `focus`, `context`, `depth`, `attrs`,
 * `styles`, `viewportOnly`, `maxSize`, `instance`. Шлёт WS `dev-dom-request`
 * соответствующему инстансу, ждёт `dev-dom-response`, возвращает JSON.
 *
 * Multi-instance: см. логику `?instance=` ниже — единая семантика с `handleExec`.
 */
import type http from 'node:http';
import type {ViteDevServer} from 'vite';
import {defaultServerWaitTimeoutMs, hmrEventDomRequest} from '../devLogger/constants';
import type {DomResponse, InstanceId} from '../devLogger/types';
import {maxDomResults, type DevLogsContext} from './types';

function writeJson(res: http.ServerResponse, status: number, body: unknown): void {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(body));
}

function listInstanceIds(ctx: DevLogsContext): InstanceId[] {
    return Array.from(ctx.instances.keys()).sort();
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function newRequestId(): string {
    if (typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }

    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function parseIntOrUndefined(value: string | null): number | undefined {
    if (value === null) {
        return undefined;
    }
    const n = Number.parseInt(value, 10);
    return Number.isFinite(n) ? n : undefined;
}

function parseEnum<T extends string>(value: string | null, allowed: readonly T[]): T | undefined {
    if (value === null) {
        return undefined;
    }
    return (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

/**
 * Принимает WS-сообщение `dev-dom-response` от браузера: сохраняет в LRU,
 * резолвит pending resolver по совпадению id.
 */
export function handleDomResponse(data: unknown, ctx: DevLogsContext): void {
    if (!isRecord(data) || typeof data.id !== 'string') {
        return;
    }

    const id = data.id;
    const entry: DomResponse = {
        ok: data.ok === true,
        value: typeof data.value === 'string' ? data.value : undefined,
        tree: data.tree,
        truncated: data.truncated === true,
        error: typeof data.error === 'string' ? data.error : undefined,
        sizeBytes: typeof data.sizeBytes === 'number' ? data.sizeBytes : undefined,
    };

    ctx.domResults.set(id, entry);

    if (ctx.domResults.size > maxDomResults) {
        const oldest = ctx.domResults.keys().next().value;

        if (oldest !== undefined) {
            ctx.domResults.delete(oldest);
        }
    }

    const resolver = ctx.pendingDom.get(id);

    if (resolver) {
        ctx.pendingDom.delete(id);
        resolver(entry);
    }
}

/** HTTP-обработчик `GET /__agent/dom`. */
export function handleDom(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    server: ViteDevServer,
    ctx: DevLogsContext,
): void {
    try {
        const parsed = new URL(req.url ?? '/', 'http://localhost');

        const formatParam = parsed.searchParams.get('format');
        const format: 'compact' | 'raw' = formatParam === 'raw' ? 'raw' : 'compact';
        const selector = parsed.searchParams.get('selector');
        const focus = parseIntOrUndefined(parsed.searchParams.get('focus'));
        const context = parseIntOrUndefined(parsed.searchParams.get('context'));
        const depth = parseIntOrUndefined(parsed.searchParams.get('depth'));
        const attrs = parseEnum<'all' | 'interactive' | 'none'>(parsed.searchParams.get('attrs'), ['all', 'interactive', 'none']);
        const styles = parseEnum<'none' | 'inline' | 'computed'>(parsed.searchParams.get('styles'), ['none', 'inline', 'computed']);
        const viewportOnlyRaw = parsed.searchParams.get('viewportOnly');
        const viewportOnly = viewportOnlyRaw === 'true' || viewportOnlyRaw === '1';
        const maxSize = parseIntOrUndefined(parsed.searchParams.get('maxSize')) ?? 500_000;

        const instanceParam = parsed.searchParams.get('instance');
        const instanceCount = ctx.instances.size;
        let targetInstance: InstanceId | undefined;

        if (instanceParam !== null) {
            if (!ctx.instances.has(instanceParam)) {
                writeJson(res, 400, {
                    error: `Unknown instance '${instanceParam}'`,
                    instances: listInstanceIds(ctx),
                });
                return;
            }
            targetInstance = instanceParam;
        } else if (instanceCount === 0) {
            writeJson(res, 400, {error: 'No active browser instances'});
            return;
        } else if (instanceCount === 1) {
            targetInstance = ctx.instances.keys().next().value;
        } else {
            writeJson(res, 400, {
                error: 'multiple instances, specify ?instance=',
                instances: listInstanceIds(ctx),
            });
            return;
        }

        const spec: Record<string, unknown> = {format};
        if (selector !== null) {
            spec.selector = selector;
        }
        if (focus !== undefined) {
            spec.focus = focus;
        }
        if (context !== undefined) {
            spec.context = context;
        }
        if (depth !== undefined) {
            spec.depth = depth;
        }
        if (attrs !== undefined) {
            spec.attrs = attrs;
        }
        if (styles !== undefined) {
            spec.styles = styles;
        }
        if (viewportOnly) {
            spec.viewportOnly = true;
        }
        if (maxSize > 0) {
            spec.maxSize = maxSize;
        }

        const id = newRequestId();

        const timer = setTimeout(() => {
            const r = ctx.pendingDom.get(id);

            if (r) {
                ctx.pendingDom.delete(id);
                writeJson(res, 504, {ok: false, error: `No browser client responded within ${defaultServerWaitTimeoutMs}ms`});
            }
        }, defaultServerWaitTimeoutMs);

        ctx.pendingDom.set(id, (entry) => {
            clearTimeout(timer);

            if (!entry.ok) {
                writeJson(res, 502, {ok: false, error: entry.error ?? 'Browser error'});
                return;
            }

            if (format === 'raw') {
                const tree = entry.tree;
                const sizeBytes = entry.sizeBytes ?? (tree !== undefined ? JSON.stringify(tree).length : 0);
                const truncated = entry.truncated === true || sizeBytes > maxSize;

                if (truncated && sizeBytes > maxSize) {
                    writeJson(res, 200, {format: 'raw', tree, sizeBytes, truncated: true});
                } else {
                    writeJson(res, 200, {format: 'raw', tree, sizeBytes, truncated});
                }
                return;
            }

            writeJson(res, 200, {format: 'compact', lines: entry.value ?? ''});
        });

        server.ws.send({
            type: 'custom',
            event: hmrEventDomRequest,
            data: {id, spec, instanceId: targetInstance},
        });
    } catch {
        res.statusCode = 500;
        res.end('Internal error');
    }
}
