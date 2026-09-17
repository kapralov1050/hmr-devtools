import type http from 'node:http';
import type {Plugin} from 'vite';
// eslint-disable-next-line no-restricted-imports -- алиасы Vite недоступны в плагине
import type {LogPayload} from '../src/utils/devLogger/types';
// eslint-disable-next-line no-restricted-imports -- алиасы Vite недоступны в плагине
import {endpoint, execEndpoint} from '../src/utils/devLogger/constants';

const maxEntries = 5000;

interface DevExecResult {
    ok: boolean;
    value?: string;
    error?: string;
    ts: string;
}

const maxExecResults = 50;

function writeJson(res: http.ServerResponse, status: number, body: unknown): void {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(body));
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
        msg: typeof raw.msg === 'string' ? raw.msg : String(raw.msg ?? ''),
        url: str(raw.url),
        stack: typeof raw.stack === 'string' ? raw.stack : undefined,
        method: typeof raw.method === 'string' ? raw.method : undefined,
        status: typeof raw.status === 'number' ? raw.status : undefined,
        netUrl: typeof raw.netUrl === 'string' ? raw.netUrl : undefined,
        durationMs: typeof raw.durationMs === 'number' ? raw.durationMs : undefined,
    };
}

function isSystem(entry: LogPayload): boolean {
    return entry.type === 'session' || entry.type === 'truncate';
}

function devBrowserLogs(): Plugin {
    const buffer: LogPayload[] = [];
    const execResults = new Map<string, DevExecResult>();
    const pendingExec = new Map<string, (r: DevExecResult) => void>();

    function push(entry: LogPayload): void {
        buffer.push(entry);

        if (buffer.length > maxEntries) {
            const dropCount = Math.floor(buffer.length / 2);
            buffer.splice(0, dropCount);
            buffer.push({
                ts: new Date().toISOString(),
                level: 'info',
                type: 'truncate',
                msg: `Ring buffer trimmed ${dropCount} entries`,
                url: '',
            });
        }
    }

    return {
        name: 'dev-browser-logs',
        configureServer(server) {
            buffer.length = 0;
            push({
                ts: new Date().toISOString(),
                level: 'info',
                type: 'session',
                msg: '--- Dev session started ---',
                url: '',
            });

            // Приём логов через HMR WebSocket (не виден в Network-вкладке DevTools)
            server.ws.on('dev-log', (data) => {
                const entry = parseLogEntry(data);

                if (entry) {
                    push(entry);
                }
            });

            // Приём результатов выполнения кода из браузера
            server.ws.on('dev-exec-result', (data) => {
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

                execResults.set(id, entry);

                if (execResults.size > maxExecResults) {
                    const oldest = execResults.keys().next().value;

                    if (oldest !== undefined) {
                        execResults.delete(oldest);
                    }
                }

                const resolver = pendingExec.get(id);

                if (resolver) {
                    pendingExec.delete(id);
                    resolver(entry);
                }
            });

            // HTTP-эндпоинт для чтения логов агентом (node-скрипт из контейнера)
            server.middlewares.use(endpoint, (req: http.IncomingMessage, res: http.ServerResponse) => {
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

                    let entries = buffer.slice();

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
            });

            // HTTP-эндпоинт выполнения JS в подключённом браузере (GET/POST, код в ?code=)
            server.middlewares.use(execEndpoint, (req: http.IncomingMessage, res: http.ServerResponse) => {
                try {
                    const parsed = new URL(req.url ?? '/', 'http://localhost');

                    const idParam = parsed.searchParams.get('id');

                    if (idParam) {
                        const entry = execResults.get(idParam);

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

                    const id =
                        typeof crypto.randomUUID === 'function'
                            ? crypto.randomUUID()
                            : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
                    const timeoutMs = Number.parseInt(parsed.searchParams.get('timeout') ?? '', 10);
                    const timeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 10000;

                    pendingExec.set(id, (entry) => {
                        clearTimeout(timer);
                        writeJson(res, 200, entry);
                    });

                    const timer = setTimeout(() => {
                        const r = pendingExec.get(id);

                        if (r) {
                            pendingExec.delete(id);
                            writeJson(res, 504, {ok: false, error: `No browser client responded within ${timeout}ms`});
                        }
                    }, timeout);

                    server.ws.send({type: 'custom', event: 'dev-exec', data: {id, code}});
                } catch {
                    res.statusCode = 500;
                    res.end('Internal error');
                }
            });
        },
    };
}

export default devBrowserLogs;
