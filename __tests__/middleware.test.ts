/**
 * Integration smoke tests for `handleLogs` (`GET /__dev_logs`) and
 * `handleDevLog` (WS `dev-log` ingestion).
 *
 * No real Vite/connect server is spun up: we call the handlers directly
 * with minimal `req`/`res` mocks (see `./helpers.ts`). The handlers only
 * touch `req.url`, `res.statusCode`, `res.setHeader`, `res.end`, and the
 * `DevLogsContext` — that surface is fully covered by the helpers.
 */
import {beforeEach, describe, expect, it} from 'vitest';
import type {LogPayload} from '../devLogger/types';
import {handleDevLog, handleLogs} from '../devBrowserLogs/logs';
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

function parseNdjson(body: string): LogPayload[] {
    return body
        .split('\n')
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line) as LogPayload);
}

describe('handleLogs (GET /__dev_logs)', () => {
    let ctx: ReturnType<typeof createContext>;

    beforeEach(() => {
        ctx = createContext();
    });

    it('a) returns empty NDJSON body on empty buffer', () => {
        const req = createReq('/__dev_logs');
        const res = createRes();

        handleLogs(req, res, ctx);

        expect(res.statusCode).toBe(200);
        expect(res.headers['content-type']).toBe('text/plain; charset=utf-8');
        expect(res.body).toBe('');
    });

    it('b) returns 3 NDJSON lines after 3 pushes (single-instance back-compat)', () => {
        ctx.push('tab-1', log({msg: 'one'}));
        ctx.push('tab-1', log({msg: 'two'}));
        ctx.push('tab-1', log({msg: 'three'}));

        const req = createReq('/__dev_logs');
        const res = createRes();
        handleLogs(req, res, ctx);

        expect(res.statusCode).toBe(200);
        const entries = parseNdjson(res.body);
        expect(entries).toHaveLength(3);
        expect(entries.map((e) => e.msg)).toEqual(['one', 'two', 'three']);
    });

    it('c) ?level=error returns only error entries plus system markers', () => {
        ctx.push('tab-1', log({level: 'info', msg: 'i-msg', type: 'console'}));
        ctx.push('tab-1', log({level: 'error', msg: 'e-msg', type: 'console'}));
        ctx.push('tab-1', {ts: '2026-01-01T00:00:00.000Z', level: 'info', type: 'session', msg: 'sess', url: ''});
        ctx.push('tab-1', {ts: '2026-01-01T00:00:00.000Z', level: 'info', type: 'truncate', msg: 'trim', url: ''});
        ctx.push('tab-1', log({level: 'warn', msg: 'w-msg', type: 'console'}));

        const req = createReq('/__dev_logs?level=error');
        const res = createRes();
        handleLogs(req, res, ctx);

        const entries = parseNdjson(res.body);
        const msgs = entries.map((e) => e.msg);
        expect(msgs).toContain('e-msg');
        expect(msgs).toContain('sess');
        expect(msgs).toContain('trim');
        expect(msgs).not.toContain('i-msg');
        expect(msgs).not.toContain('w-msg');
    });

    it('d) ?type=network returns only network entries plus system markers', () => {
        ctx.push('tab-1', log({type: 'console', msg: 'console-msg'}));
        ctx.push('tab-1', log({type: 'network', msg: 'net-msg', method: 'GET', status: 200, netUrl: '/x'}));
        ctx.push('tab-1', {ts: '2026-01-01T00:00:00.000Z', level: 'info', type: 'session', msg: 'sess', url: ''});
        ctx.push('tab-1', log({type: 'error', msg: 'err-msg'}));

        const req = createReq('/__dev_logs?type=network');
        const res = createRes();
        handleLogs(req, res, ctx);

        const entries = parseNdjson(res.body);
        const msgs = entries.map((e) => e.msg);
        expect(msgs).toContain('net-msg');
        expect(msgs).toContain('sess');
        expect(msgs).not.toContain('console-msg');
        expect(msgs).not.toContain('err-msg');
    });

    it('e) ?limit=2 returns the last 2 entries', () => {
        ctx.push('tab-1', log({msg: 'one'}));
        ctx.push('tab-1', log({msg: 'two'}));
        ctx.push('tab-1', log({msg: 'three'}));
        ctx.push('tab-1', log({msg: 'four'}));

        const req = createReq('/__dev_logs?limit=2');
        const res = createRes();
        handleLogs(req, res, ctx);

        const entries = parseNdjson(res.body);
        expect(entries).toHaveLength(2);
        expect(entries.map((e) => e.msg)).toEqual(['three', 'four']);
    });
});

describe('handleDevLog (WS dev-log ingestion)', () => {
    it('f) pushes a parsed entry into the buffer (legacy format → default instance)', () => {
        const ctx = createContext();

        handleDevLog(
            {
                ts: '2026-01-01T00:00:00.000Z',
                level: 'warn',
                type: 'console',
                msg: 'browser warn',
                url: 'http://localhost/page',
            },
            ctx,
        );

        const buf = ctx.instances.get('default')?.buffer;
        expect(buf).toBeDefined();
        expect(buf).toHaveLength(1);
        expect(buf?.[0]?.msg).toBe('browser warn');
        expect(buf?.[0]?.level).toBe('warn');
    });

    it('ignores malformed payloads without throwing', () => {
        const ctx = createContext();

        // Missing required `ts`/`level` → parseLogEntry returns null → no push
        expect(() => handleDevLog({level: 'log'}, ctx)).not.toThrow();
        expect(ctx.instances.size).toBe(0);

        // Non-object payload
        expect(() => handleDevLog('garbage', ctx)).not.toThrow();
        expect(ctx.instances.size).toBe(0);
    });
});
