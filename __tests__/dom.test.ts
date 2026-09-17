/**
 * Tests for `devBrowserLogs/dom.ts` — server-side `GET /__agent/dom` handler.
 *
 * Pattern mirrors `__tests__/exec.test.ts`: we call handlers directly with
 * minimal `req`/`res` mocks, capture WS messages, simulate browser reply.
 */
import {beforeEach, describe, expect, it} from 'vitest';
import type {LogPayload} from '../src/client/types';
import {handleDom, handleDomResponse} from '../src/server/dom';
import {createContext, createMockServer, createReq, createRes} from './helpers';

const emptyEntry: LogPayload = {ts: '', level: '', type: '', msg: '', url: ''};

describe('handleDom (GET /__agent/dom)', () => {
    let ctx: ReturnType<typeof createContext>;
    let server: ReturnType<typeof createMockServer>;

    beforeEach(() => {
        ctx = createContext();
        server = createMockServer();
    });

    it('returns 400 when no active browser instances and no ?instance=', () => {
        const req = createReq('/__agent/dom?format=compact');
        const res = createRes();

        handleDom(req, res, server as never, ctx);

        expect(res.statusCode).toBe(400);
        expect(res.headers['content-type']).toBe('application/json');
        expect(server.ws.sent).toHaveLength(0);
        const body = JSON.parse(res.body) as {error: string};
        expect(body.error).toMatch(/no active/i);
    });

    it('returns 400 + instance list when 2+ instances and no ?instance=', () => {
        ctx.push('a', emptyEntry);
        ctx.push('b', emptyEntry);

        const req = createReq('/__agent/dom?format=compact');
        const res = createRes();

        handleDom(req, res, server as never, ctx);

        expect(res.statusCode).toBe(400);
        expect(server.ws.sent).toHaveLength(0);
        const body = JSON.parse(res.body) as {error: string; instances: string[]};
        expect(body.error).toMatch(/multiple instances/);
        expect(body.instances).toEqual(['a', 'b']);
    });

    it('returns 400 for unknown ?instance=', () => {
        ctx.push('tab-1', emptyEntry);

        const req = createReq('/__agent/dom?format=compact&instance=ghost');
        const res = createRes();

        handleDom(req, res, server as never, ctx);

        expect(res.statusCode).toBe(400);
        expect(server.ws.sent).toHaveLength(0);
        const body = JSON.parse(res.body) as {error: string};
        expect(body.error).toMatch(/unknown instance/i);
    });

    it('back-compat: exactly 1 instance and no ?instance= targets that instance', () => {
        ctx.push('only', emptyEntry);

        const req = createReq('/__agent/dom?format=compact');
        const res = createRes();

        handleDom(req, res, server as never, ctx);

        expect(server.ws.sent).toHaveLength(1);
        const payload = server.ws.sent[0] as {type: string; event: string; data: {instanceId: string; spec: {format: string}}};
        expect(payload.event).toBe('dev-dom-request');
        expect(payload.data.instanceId).toBe('only');
        expect(payload.data.spec.format).toBe('compact');
    });

    it('compact: registers pending resolver, resolves with {format, lines} on browser reply', () => {
        ctx.push('tab-1', emptyEntry);

        const req = createReq('/__agent/dom?format=compact&selector=.btn');
        const res = createRes();

        handleDom(req, res, server as never, ctx);

        expect(ctx.pendingDom.size).toBe(1);
        const id = (server.ws.sent[0] as {data: {id: string}}).data.id;

        // Simulate browser reply
        handleDomResponse({id, ok: true, value: 'button#1 Submit'}, ctx);

        expect(res.statusCode).toBe(200);
        expect(ctx.pendingDom.size).toBe(0);
        const body = JSON.parse(res.body) as {format: string; lines: string};
        expect(body.format).toBe('compact');
        expect(body.lines).toBe('button#1 Submit');
    });

    it('raw: resolves with {format, tree, sizeBytes} on browser reply', () => {
        ctx.push('tab-1', emptyEntry);

        const req = createReq('/__agent/dom?format=raw&depth=2');
        const res = createRes();

        handleDom(req, res, server as never, ctx);

        const id = (server.ws.sent[0] as {data: {id: string}}).data.id;
        const fakeTree = [{tag: 'div', children: []}];

        handleDomResponse({id, ok: true, tree: fakeTree, sizeBytes: 100, truncated: false}, ctx);

        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body) as {format: string; tree: unknown[]; sizeBytes: number; truncated: boolean};
        expect(body.format).toBe('raw');
        expect(body.tree).toEqual(fakeTree);
        expect(body.sizeBytes).toBe(100);
        expect(body.truncated).toBe(false);
    });

    it('compact: browser-side error is propagated as 502', () => {
        ctx.push('tab-1', emptyEntry);

        const req = createReq('/__agent/dom?format=compact');
        const res = createRes();

        handleDom(req, res, server as never, ctx);
        const id = (server.ws.sent[0] as {data: {id: string}}).data.id;

        handleDomResponse({id, ok: false, error: 'boom'}, ctx);

        expect(res.statusCode).toBe(502);
        const body = JSON.parse(res.body) as {ok: boolean; error: string};
        expect(body.error).toBe('boom');
    });
});

describe('handleDomResponse (incoming WS dev-dom-response)', () => {
    let ctx: ReturnType<typeof createContext>;

    beforeEach(() => {
        ctx = createContext();
    });

    it('resolves matching pending resolver', () => {
        const seen: unknown[] = [];
        ctx.pendingDom.set('abc', (entry) => {
            seen.push(entry);
        });

        handleDomResponse({id: 'abc', ok: true, value: 'compact-line'}, ctx);

        expect(seen).toHaveLength(1);
        const entry = seen[0] as {ok: boolean; value: string};
        expect(entry.ok).toBe(true);
        expect(entry.value).toBe('compact-line');

        expect(ctx.pendingDom.has('abc')).toBe(false);
        expect(ctx.domResults.has('abc')).toBe(true);
    });

    it('caches result for unknown id (LRU) and does not throw', () => {
        expect(() => handleDomResponse({id: 'ghost', ok: true, value: 'x'}, ctx)).not.toThrow();
        expect(ctx.domResults.has('ghost')).toBe(true);
        expect(ctx.pendingDom.size).toBe(0);
    });

    it('ignores malformed payloads without throwing', () => {
        expect(() => handleDomResponse({ok: true}, ctx)).not.toThrow();
        expect(() => handleDomResponse(null, ctx)).not.toThrow();
        expect(() => handleDomResponse('plain-string', ctx)).not.toThrow();
        expect(ctx.domResults.size).toBe(0);
    });
});
