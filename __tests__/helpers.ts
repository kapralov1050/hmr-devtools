/**
 * Shared test helpers for `__tests__/`.
 *
 * Approach choice: We mock `req`/`res` and `server.ws.send` directly instead of
 * spinning up `server.middlewares` (connect) or `supertest`. The handlers
 * (`handleLogs`, `handleExec`) only touch a tiny surface of `IncomingMessage`
 * (`url`) and `ServerResponse` (`statusCode`, `setHeader`, `end`), so a plain
 * object mock that records `end(data)` synchronously is enough.
 */
import type http from 'node:http';
import type {DevLogsContext} from '../src/server/types';
import {pushToBuffer} from '../src/server/logs';

export interface MockRes {
    body: string;
    statusCode: number;
    headers: Record<string, string>;
    end: (data?: string) => MockRes;
}

export function createReq(url: string): http.IncomingMessage {
    return {url} as unknown as http.IncomingMessage;
}

export function createRes(): MockRes & http.ServerResponse {
    const state = {body: '', statusCode: 200, headers: {} as Record<string, string>};

    const res: MockRes = {
        get body(): string {
            return state.body;
        },
        set body(v: string) {
            state.body = v;
        },
        get statusCode(): number {
            return state.statusCode;
        },
        set statusCode(v: number) {
            state.statusCode = v;
        },
        get headers(): Record<string, string> {
            return state.headers;
        },
        set headers(v: Record<string, string>) {
            state.headers = v;
        },
        end(data?: string): MockRes {
            if (data !== undefined) {
                state.body = data;
            }

            return res;
        },
    };

    (res as unknown as {setHeader: typeof res.end & ((n: string, v: string | number | readonly string[]) => MockRes)}).setHeader = ((
        name: string,
        value: string | number | readonly string[],
    ): MockRes => {
        state.headers[name.toLowerCase()] = String(value);
        return res;
    }) as never;

    return res as unknown as MockRes & http.ServerResponse;
}

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

export interface MockServer {
    ws: {send: (payload: unknown) => void; sent: unknown[]};
}

export function createMockServer(): MockServer {
    const sent: unknown[] = [];
    return {
        ws: {
            send(payload: unknown): void {
                sent.push(payload);
            },
            sent,
        },
    };
}
