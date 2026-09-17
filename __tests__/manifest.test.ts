/**
 * Unit tests for `handleManifest` / `buildManifest` (`GET /__agent/manifest`).
 *
 * Pattern mirrors `__tests__/middleware.test.ts`: we call handlers directly
 * with minimal `req`/`res` mocks (see `./helpers.ts`) — no real Vite server.
 */
import {beforeEach, describe, expect, it} from 'vitest';
import type http from 'node:http';
import {buildManifest, handleManifest} from '../devBrowserLogs/manifest';
import type {Manifest} from '../devLogger/types';
import packageJson from '../package.json' with {type: 'json'};
import {createRes} from './helpers';

function createReq(url: string, host?: string): http.IncomingMessage {
    const headers: Record<string, string | undefined> = {host};
    return {url, headers} as unknown as http.IncomingMessage;
}

describe('buildManifest()', () => {
    it('a) returns object with v=1, name=vite-agent-bridge, version from package.json', () => {
        const m = buildManifest();
        expect(m.v).toBe(1);
        expect(m.name).toBe('vite-agent-bridge');
        expect(m.version).toBe(packageJson.version);
    });

    it('b) declares 4 tools with the expected names', () => {
        const m = buildManifest();
        const names = m.tools.map((t) => t.name);
        expect(names).toEqual(['browser_logs', 'browser_eval', 'browser_dom', 'browser_instances']);
    });

    it('c) omits `port` field when not provided', () => {
        const m: Manifest = buildManifest();
        expect('port' in m).toBe(false);
    });

    it('d) sets `port` when explicitly provided', () => {
        const m: Manifest = buildManifest(4321);
        expect(m.port).toBe(4321);
    });

    it('e) declares capabilities and a non-empty system_hint', () => {
        const m = buildManifest();
        expect(m.capabilities).toEqual(['logs', 'eval', 'dom-compact', 'dom-raw', 'instances']);
        expect(m.system_hint.length).toBeGreaterThan(0);
    });

    it('f) every tool has name/description/endpoint/input_schema', () => {
        const m = buildManifest();
        for (const tool of m.tools) {
            expect(typeof tool.name).toBe('string');
            expect(tool.name.length).toBeGreaterThan(0);
            expect(typeof tool.description).toBe('string');
            expect(tool.description.length).toBeGreaterThan(0);
            expect(typeof tool.endpoint).toBe('string');
            expect(tool.endpoint.length).toBeGreaterThan(0);
            expect(typeof tool.input_schema).toBe('object');
            expect(tool.input_schema).not.toBeNull();
        }
    });
});

describe('handleManifest (GET /__agent/manifest)', () => {
    let res: ReturnType<typeof createRes>;

    beforeEach(() => {
        res = createRes();
    });

    it('g) responds with status 200 and application/json content type', () => {
        handleManifest(createReq('/__agent/manifest'), res);

        expect(res.statusCode).toBe(200);
        expect(res.headers['content-type']).toBe('application/json; charset=utf-8');
    });

    it('h) body parses as valid JSON with v=1 and the plugin name', () => {
        handleManifest(createReq('/__agent/manifest'), res);

        const body = JSON.parse(res.body) as Manifest;
        expect(body.v).toBe(1);
        expect(body.name).toBe('vite-agent-bridge');
        expect(body.system_hint.length).toBeGreaterThan(0);
    });

    it('i) infers port from req.headers.host', () => {
        handleManifest(createReq('/__agent/manifest', 'example.test:8765'), res);

        const body = JSON.parse(res.body) as Manifest;
        expect(body.port).toBe(8765);
    });

    it('j) returns port=null when host header has no port', () => {
        handleManifest(createReq('/__agent/manifest', 'example.test'), res);

        const body = JSON.parse(res.body) as Manifest;
        expect('port' in body).toBe(false);
    });

    it('k) returns port=null when host header is missing', () => {
        handleManifest(createReq('/__agent/manifest', undefined), res);

        const body = JSON.parse(res.body) as Manifest;
        expect('port' in body).toBe(false);
    });

    it('l) ignores non-numeric port in host header', () => {
        handleManifest(createReq('/__agent/manifest', 'example.test:abc'), res);

        const body = JSON.parse(res.body) as Manifest;
        expect('port' in body).toBe(false);
    });
});
