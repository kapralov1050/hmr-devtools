/**
 * Multi-instance tests for `handleExec` (`?instance=` filter) and
 * `handleExecResult` (fromInstance stamping).
 */
import {beforeEach, describe, expect, it} from 'vitest';
import type {LogPayload} from '../client/types';
import {handleExec, handleExecResult} from '../server/exec';
import {createContext, createMockServer, createReq, createRes} from './helpers';

const emptyEntry: LogPayload = {ts: '', level: '', type: '', msg: '', url: ''};

describe('handleExec (?instance= filter)', () => {
    let ctx: ReturnType<typeof createContext>;
    let server: ReturnType<typeof createMockServer>;

    beforeEach(() => {
        ctx = createContext();
        server = createMockServer();
    });

    it('?instance=valid targets that instance in WS payload', () => {
        ctx.push('tab-1', emptyEntry);
        const req = createReq('/__dev_exec?code=document.title&instance=tab-1');
        const res = createRes();

        handleExec(req, res, server as never, ctx);

        expect(server.ws.sent).toHaveLength(1);
        const payload = server.ws.sent[0] as {type: string; event: string; data: {id: string; code: string; instanceId: string}};
        expect(payload.event).toBe('dev-exec');
        expect(payload.data.code).toBe('document.title');
        expect(payload.data.instanceId).toBe('tab-1');
    });

    it('back-compat: exactly 1 instance and no ?instance= uses that instance', () => {
        ctx.push('only', emptyEntry);
        const req = createReq('/__dev_exec?code=1');
        const res = createRes();

        handleExec(req, res, server as never, ctx);

        expect(server.ws.sent).toHaveLength(1);
        const payload = server.ws.sent[0] as {data: {instanceId: string}};
        expect(payload.data.instanceId).toBe('only');
    });

    it('returns 400 with instance list when >1 instances and no ?instance=', () => {
        ctx.push('a', emptyEntry);
        ctx.push('b', emptyEntry);

        const req = createReq('/__dev_exec?code=1');
        const res = createRes();

        handleExec(req, res, server as never, ctx);

        expect(res.statusCode).toBe(400);
        expect(res.headers['content-type']).toBe('application/json');
        expect(server.ws.sent).toHaveLength(0);
        const body = JSON.parse(res.body) as {error: string; instances: string[]};
        expect(body.error).toMatch(/multiple instances/);
        expect(body.instances).toEqual(['a', 'b']);
    });

    it('returns 400 for unknown ?instance=', () => {
        ctx.push('tab-1', emptyEntry);

        const req = createReq('/__dev_exec?code=1&instance=ghost');
        const res = createRes();

        handleExec(req, res, server as never, ctx);

        expect(res.statusCode).toBe(400);
        expect(server.ws.sent).toHaveLength(0);
    });

    it('returns 400 when no active instances and no ?instance=', () => {
        const req = createReq('/__dev_exec?code=1');
        const res = createRes();

        handleExec(req, res, server as never, ctx);

        expect(res.statusCode).toBe(400);
        expect(server.ws.sent).toHaveLength(0);
    });
});

describe('handleExecResult (fromInstance stamping)', () => {
    it('stores fromInstance in cached result envelope', () => {
        const ctx = createContext();
        handleExecResult({id: 'r1', fromInstance: 'tab-1', ok: true, value: 'x'}, ctx);

        const entry = ctx.execResults.get('r1');
        expect(entry?.fromInstance).toBe('tab-1');
    });

    it('legacy payload (no fromInstance) is still accepted (fromInstance undefined)', () => {
        const ctx = createContext();
        handleExecResult({id: 'r1', ok: true, value: 'x'}, ctx);

        const entry = ctx.execResults.get('r1');
        expect(entry).toBeDefined();
        expect(entry?.fromInstance).toBeUndefined();
    });

    it('still resolves pending resolver when result includes fromInstance', () => {
        const ctx = createContext();
        const seen: unknown[] = [];
        ctx.pendingExec.set('abc', (entry) => {
            seen.push(entry);
        });

        handleExecResult({id: 'abc', fromInstance: 'tab-1', ok: true, value: '42'}, ctx);

        expect(seen).toHaveLength(1);
        const entry = seen[0] as {ok: boolean; value: string; fromInstance: string};
        expect(entry.fromInstance).toBe('tab-1');
        expect(ctx.pendingExec.has('abc')).toBe(false);
    });
});
