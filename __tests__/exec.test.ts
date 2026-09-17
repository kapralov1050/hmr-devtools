/**
 * Smoke tests for the exec endpoint (`/__dev_exec`) handlers.
 *
 * `handleExec` sends an HMR WS message via `server.ws.send` and waits for
 * the matching `dev-exec-result` to resolve the response. We don't run a
 * real Vite dev server — `createMockServer` provides a `ws.send` stub we can
 * assert against and use to simulate the browser's reply synchronously.
 */
import {beforeEach, describe, expect, it} from 'vitest';
import type {LogPayload} from '../devLogger/types';
import {handleExec, handleExecResult} from '../devBrowserLogs/exec';
import {createContext, createMockServer, createReq, createRes} from './helpers';

const emptyEntry: LogPayload = {ts: '', level: '', type: '', msg: '', url: ''};

describe('handleExec (GET /__dev_exec)', () => {
    let ctx: ReturnType<typeof createContext>;
    let server: ReturnType<typeof createMockServer>;

    beforeEach(() => {
        ctx = createContext();
        // Регистрируем единственный инстанс (back-compat: ровно 1 → без ?instance= работает)
        ctx.push('tab-1', emptyEntry);
        server = createMockServer();
    });

    it('a) returns 400 when ?code is missing', () => {
        const req = createReq('/__dev_exec');
        const res = createRes();

        handleExec(req, res, server as never, ctx);

        expect(res.statusCode).toBe(400);
        expect(res.body).toBe('Missing ?code=');
        expect(server.ws.sent).toHaveLength(0);
        expect(ctx.pendingExec.size).toBe(0);
    });

    it('b) sends a dev-exec WS message and registers a pending resolver', () => {
        const req = createReq('/__dev_exec?code=document.title');
        const res = createRes();

        handleExec(req, res, server as never, ctx);

        // Exactly one WS message sent with the right shape
        expect(server.ws.sent).toHaveLength(1);
        const payload = server.ws.sent[0] as {type: string; event: string; data: {id: string; code: string; instanceId: string}};
        expect(payload.type).toBe('custom');
        expect(payload.event).toBe('dev-exec');
        expect(payload.data.code).toBe('document.title');
        expect(payload.data.instanceId).toBe('tab-1');
        expect(typeof payload.data.id).toBe('string');
        expect(payload.data.id.length).toBeGreaterThan(0);

        // Resolver registered under that id; response not yet written
        expect(ctx.pendingExec.size).toBe(1);
        expect(ctx.pendingExec.has(payload.data.id)).toBe(true);
        expect(res.statusCode).toBe(200); // default, no response yet
        expect(res.body).toBe('');
    });

    it('c) simulates browser reply → resolves promise, removes from pending, stores result', () => {
        const req = createReq('/__dev_exec?code=1%2B1');
        const res = createRes();
        handleExec(req, res, server as never, ctx);

        const payload = server.ws.sent[0] as {data: {id: string}};
        const id = payload.data.id;

        // Browser-style reply
        handleExecResult({id, ok: true, value: '2'}, ctx);

        expect(res.statusCode).toBe(200);
        expect(res.headers['content-type']).toBe('application/json');
        const parsed = JSON.parse(res.body) as {ok: boolean; value: string};
        expect(parsed.ok).toBe(true);
        expect(parsed.value).toBe('2');

        // pendingExec cleared, execResults populated
        expect(ctx.pendingExec.size).toBe(0);
        expect(ctx.execResults.has(id)).toBe(true);
    });

    it('e) with ?id=existing returns the previously stored result', () => {
        // Seed a result directly
        ctx.execResults.set('stale-id', {ok: true, value: 'cached', ts: '2026-01-01T00:00:00.000Z'});

        const req = createReq('/__dev_exec?id=stale-id');
        const res = createRes();
        handleExec(req, res, server as never, ctx);

        expect(res.statusCode).toBe(200);
        expect(res.headers['content-type']).toBe('application/json');
        const parsed = JSON.parse(res.body) as {ok: boolean; value: string};
        expect(parsed.ok).toBe(true);
        expect(parsed.value).toBe('cached');

        // No new WS message was sent
        expect(server.ws.sent).toHaveLength(0);
    });

    it('returns 404 for an unknown ?id', () => {
        const req = createReq('/__dev_exec?id=does-not-exist');
        const res = createRes();
        handleExec(req, res, server as never, ctx);

        expect(res.statusCode).toBe(404);
        expect(res.body).toBe('Not found');
    });
});

describe('handleExecResult (incoming WS dev-exec-result)', () => {
    let ctx: ReturnType<typeof createContext>;

    beforeEach(() => {
        ctx = createContext();
    });

    it('c) resolves matching pending promise and stores in execResults', () => {
        const seen: unknown[] = [];
        ctx.pendingExec.set('abc', (entry) => {
            seen.push(entry);
        });

        handleExecResult({id: 'abc', ok: true, value: '42'}, ctx);

        expect(seen).toHaveLength(1);
        const entry = seen[0] as {ok: boolean; value: string};
        expect(entry.ok).toBe(true);
        expect(entry.value).toBe('42');

        expect(ctx.pendingExec.has('abc')).toBe(false);
        expect(ctx.execResults.has('abc')).toBe(true);
    });

    it('d) caches the result for an unknown id (LRU) and does not throw', () => {
        // Семантика: execResults — это LRU-кеш последних результатов для
        // последующих `GET /__dev_exec?id=...` запросов. Отсутствие pending
        // resolver'а не означает «отбросить» — это означает «никто сейчас
        // не ждёт, но кеш обновляется».
        expect(() => handleExecResult({id: 'ghost', ok: true, value: 'x'}, ctx)).not.toThrow();
        expect(ctx.execResults.has('ghost')).toBe(true);
        expect(ctx.pendingExec.size).toBe(0);
    });

    it('ignores malformed payloads (no string id) without throwing', () => {
        expect(() => handleExecResult({ok: true}, ctx)).not.toThrow();
        expect(() => handleExecResult(null, ctx)).not.toThrow();
        expect(() => handleExecResult('plain-string', ctx)).not.toThrow();
        expect(ctx.execResults.size).toBe(0);
    });
});
