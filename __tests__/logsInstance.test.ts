/**
 * Multi-instance tests for `handleLogs` (`?instance=` filter) and
 * `handleDevLog` (envelope parsing).
 */
import {beforeEach, describe, expect, it} from 'vitest';
import type {LogPayload} from '../client/types';
import {handleDevLog, handleLogs} from '../server/logs';
import {createContext, createReq, createRes} from './helpers';

function log(overrides: Partial<LogPayload> = {}): LogPayload {
    return {
        ts: '2026-01-01T00:00:00.000Z',
        level: 'log',
        type: 'console',
        msg: 'hello',
        url: 'http://localhost/',
        ...overrides,
    };
}

describe('handleLogs (?instance= filter)', () => {
    let ctx: ReturnType<typeof createContext>;

    beforeEach(() => {
        ctx = createContext();
    });

    it('?instance=a filters to that instance buffer', () => {
        ctx.push('a', log({msg: 'a-1'}));
        ctx.push('a', log({msg: 'a-2'}));
        ctx.push('b', log({msg: 'b-1'}));

        const res = createRes();
        handleLogs(createReq('/__dev_logs?instance=a'), res, ctx);

        expect(res.statusCode).toBe(200);
        const lines = res.body.split('\n').filter((l) => l.length > 0);
        expect(lines).toHaveLength(2);
        const entries = lines.map((l) => JSON.parse(l) as LogPayload);
        expect(entries.map((e) => e.msg).sort()).toEqual(['a-1', 'a-2']);
    });

    it('returns 400 with instance list when >1 instances and no ?instance=', () => {
        ctx.push('a', log());
        ctx.push('b', log());

        const res = createRes();
        handleLogs(createReq('/__dev_logs'), res, ctx);

        expect(res.statusCode).toBe(400);
        expect(res.headers['content-type']).toBe('application/json');
        const body = JSON.parse(res.body) as {error: string; instances: string[]};
        expect(body.error).toMatch(/multiple instances/);
        expect(body.instances).toEqual(['a', 'b']);
    });

    it('returns 404 for unknown instance', () => {
        ctx.push('a', log());

        const res = createRes();
        handleLogs(createReq('/__dev_logs?instance=nope'), res, ctx);

        expect(res.statusCode).toBe(404);
        const body = JSON.parse(res.body) as {error: string};
        expect(body.error).toMatch(/Unknown instance/);
    });

    it('respects ?instance= together with ?level= and ?limit=', () => {
        ctx.push('a', log({msg: 'a-info', level: 'info'}));
        ctx.push('a', log({msg: 'a-err', level: 'error'}));
        ctx.push('b', log({msg: 'b-err', level: 'error'}));

        const res = createRes();
        handleLogs(createReq('/__dev_logs?instance=a&level=error'), res, ctx);

        expect(res.statusCode).toBe(200);
        const lines = res.body.split('\n').filter((l) => l.length > 0);
        expect(lines).toHaveLength(1);
        const entry = JSON.parse(lines[0]) as LogPayload;
        expect(entry.msg).toBe('a-err');
    });
});

describe('handleDevLog (envelope vs legacy)', () => {
    it('parses {id, payload} envelope and routes to that instance', () => {
        const ctx = createContext();
        handleDevLog(
            {id: 'tab-1', payload: log({msg: 'from-envelope'})},
            ctx,
        );

        const buf = ctx.instances.get('tab-1')?.buffer;
        expect(buf).toBeDefined();
        expect(buf).toHaveLength(1);
        expect(buf?.[0]?.msg).toBe('from-envelope');
        expect(ctx.instances.has('default')).toBe(false);
    });

    it('falls back to "default" instance for legacy format (no envelope)', () => {
        const ctx = createContext();
        handleDevLog(log({msg: 'legacy'}), ctx);

        const buf = ctx.instances.get('default')?.buffer;
        expect(buf).toBeDefined();
        expect(buf).toHaveLength(1);
        expect(buf?.[0]?.msg).toBe('legacy');
    });

    it('ignores envelope without payload field', () => {
        const ctx = createContext();
        handleDevLog({id: 'tab-1'}, ctx);
        expect(ctx.instances.size).toBe(0);
    });
});
