/**
 * Серверная обработка `GET /__agent/instances`.
 *
 * Возвращает JSON-массив активных browser-инстансов: `[{id, url, title, lastSeen}, ...]`.
 * Поддерживает опциональный фильтр `?since=ISO`, оставляющий только инстансы
 * с `lastSeen >= since`.
 */
import type http from 'node:http';
import {listInstances} from './instanceRegistry';
import type {DevLogsContext} from './types';

function writeJson(res: http.ServerResponse, status: number, body: unknown): void {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(body));
}

/** HTTP-обработчик `GET /__agent/instances`. */
export function handleInstances(req: http.IncomingMessage, res: http.ServerResponse, ctx: DevLogsContext): void {
    try {
        const parsed = new URL(req.url ?? '/', 'http://localhost');
        const sinceFilter = parsed.searchParams.get('since');
        let states = listInstances(ctx);

        if (sinceFilter !== null) {
            const sinceMs = Date.parse(sinceFilter);
            if (Number.isNaN(sinceMs)) {
                writeJson(res, 400, {error: `Invalid 'since' parameter: ${sinceFilter}`});
                return;
            }
            states = states.filter((s) => Date.parse(s.lastSeen) >= sinceMs);
        }

        writeJson(res, 200, states);
    } catch {
        writeJson(res, 500, {error: 'Internal error'});
    }
}
