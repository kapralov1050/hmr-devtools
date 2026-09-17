/**
 * Unit tests for `handleInstances` (`GET /__agent/instances`).
 *
 * Pattern: call handler directly with minimal `req`/`res` mocks (see `./helpers.ts`).
 */
import {beforeEach, describe, expect, it} from 'vitest';
import {ensureInstance} from '../server/instanceRegistry';
import {handleInstances} from '../server/instances';
import type {InstanceState} from '../client/types';
import {createContext, createReq, createRes} from './helpers';

type ParsedInstance = InstanceState;

function parseBody<T>(body: string): T {
    return JSON.parse(body) as T;
}

describe('handleInstances (GET /__agent/instances)', () => {
    let ctx: ReturnType<typeof createContext>;

    beforeEach(() => {
        ctx = createContext();
    });

    it('a) returns empty array with status 200 and application/json when no instances', () => {
        const res = createRes();
        handleInstances(createReq('/__agent/instances'), res, ctx);

        expect(res.statusCode).toBe(200);
        expect(res.headers['content-type']).toBe('application/json');
        expect(parseBody<ParsedInstance[]>(res.body)).toEqual([]);
    });

    it('b) returns array of 2 elements, each with id/url/title/lastSeen', () => {
        ctx.push('tab-a', {
            ts: '2026-01-01T00:00:00.000Z',
            level: 'log',
            type: 'console',
            msg: 'a',
            url: '/home',
        });
        ensureInstance(ctx, 'tab-b', {url: '/login', title: 'Login'});

        const res = createRes();
        handleInstances(createReq('/__agent/instances'), res, ctx);

        expect(res.statusCode).toBe(200);
        expect(res.headers['content-type']).toBe('application/json');

        const list = parseBody<ParsedInstance[]>(res.body);
        expect(list).toHaveLength(2);
        for (const item of list) {
            expect(typeof item.id).toBe('string');
            expect(typeof item.url).toBe('string');
            expect(typeof item.title).toBe('string');
            expect(typeof item.lastSeen).toBe('string');
        }
    });

    it('c) preserves url/title/lastSeen values from registered instances', () => {
        const fixedLastSeen = '2026-01-01T00:00:00.000Z';
        ensureInstance(ctx, 'tab-b', {url: '/login', title: 'Login'});

        // ensureInstance sets lastSeen to now; override to make assertion deterministic.
        const entry = ctx.instances.get('tab-b');
        if (entry) {
            entry.lastSeen = fixedLastSeen;
        }

        const res = createRes();
        handleInstances(createReq('/__agent/instances'), res, ctx);

        const list = parseBody<ParsedInstance[]>(res.body);
        expect(list).toHaveLength(1);
        expect(list[0]?.id).toBe('tab-b');
        expect(list[0]?.url).toBe('/login');
        expect(list[0]?.title).toBe('Login');
        expect(list[0]?.lastSeen).toBe(fixedLastSeen);
    });

    it('d) does not include buffer field in the output', () => {
        ensureInstance(ctx, 'tab-x', {url: '/x', title: 'X'});

        const res = createRes();
        handleInstances(createReq('/__agent/instances'), res, ctx);

        const list = parseBody<ParsedInstance[]>(res.body);
        expect(list).toHaveLength(1);
        expect(list[0]).not.toHaveProperty('buffer');
    });

    it('e) ?since=ISO filters in instances with lastSeen >= since', () => {
        const a = ensureInstance(ctx, 'a');
        a.lastSeen = '2026-01-01T00:00:00.000Z';
        const b = ensureInstance(ctx, 'b');
        b.lastSeen = '2026-01-02T00:00:00.000Z';
        const c = ensureInstance(ctx, 'c');
        c.lastSeen = '2026-01-03T00:00:00.000Z';

        const res = createRes();
        handleInstances(createReq('/__agent/instances?since=2026-01-02T00:00:00.000Z'), res, ctx);

        const list = parseBody<ParsedInstance[]>(res.body);
        const ids = list.map((s) => s.id).sort();
        expect(ids).toEqual(['b', 'c']);
    });

    it('f) ?since=ISO with no matches returns empty array', () => {
        ensureInstance(ctx, 'a');
        const entry = ctx.instances.get('a');
        if (entry) {
            entry.lastSeen = '2020-01-01T00:00:00.000Z';
        }

        const res = createRes();
        handleInstances(createReq('/__agent/instances?since=2026-01-01T00:00:00.000Z'), res, ctx);

        expect(res.statusCode).toBe(200);
        expect(parseBody<ParsedInstance[]>(res.body)).toEqual([]);
    });

    it('g) ?since= with invalid date returns 400', () => {
        ensureInstance(ctx, 'a');
        const res = createRes();
        handleInstances(createReq('/__agent/instances?since=not-a-date'), res, ctx);

        expect(res.statusCode).toBe(400);
        expect(res.headers['content-type']).toBe('application/json');
        const body = parseBody<{error: string}>(res.body);
        expect(body.error).toMatch(/Invalid/);
    });

    it.todo('verify request method (currently ignored)');
});
