/**
 * Tests for `devBrowserLogs/instanceRegistry.ts`: ensureInstance, pruneStaleInstances,
 * listInstances, handleInstanceRegister, handleInstanceHeartbeat.
 */
import {beforeEach, describe, expect, it} from 'vitest';
import {
    defaultPruneMaxAgeMs,
    ensureInstance,
    handleInstanceHeartbeat,
    handleInstanceRegister,
    listInstances,
    pruneStaleInstances,
} from '../src/server/instanceRegistry';
import {createContext} from './helpers';

describe('ensureInstance', () => {
    let ctx: ReturnType<typeof createContext>;

    beforeEach(() => {
        ctx = createContext();
    });

    it('creates a new instance on first call', () => {
        const inst = ensureInstance(ctx, 'tab-1');
        expect(inst.id).toBe('tab-1');
        expect(inst.url).toBe('');
        expect(inst.title).toBe('');
        expect(typeof inst.lastSeen).toBe('string');
        expect(Array.isArray(inst.buffer)).toBe(true);
        expect(ctx.instances.size).toBe(1);
    });

    it('uses provided meta on creation', () => {
        const inst = ensureInstance(ctx, 'tab-1', {url: '/login', title: 'Login'});
        expect(inst.url).toBe('/login');
        expect(inst.title).toBe('Login');
    });

    it('updates lastSeen on subsequent calls', async () => {
        const first = ensureInstance(ctx, 'tab-1');
        const firstLastSeen = first.lastSeen;
        await new Promise((r) => setTimeout(r, 5));
        const second = ensureInstance(ctx, 'tab-1');
        expect(second.lastSeen).not.toBe(firstLastSeen);
        expect(ctx.instances.size).toBe(1);
    });

    it('updates meta on subsequent calls', () => {
        ensureInstance(ctx, 'tab-1', {url: '/old', title: 'Old'});
        const updated = ensureInstance(ctx, 'tab-1', {url: '/new', title: 'New'});
        expect(updated.url).toBe('/new');
        expect(updated.title).toBe('New');
    });
});

describe('pruneStaleInstances', () => {
    let ctx: ReturnType<typeof createContext>;

    beforeEach(() => {
        ctx = createContext();
    });

    it('removes instances with lastSeen older than maxAgeMs', () => {
        const stale = ensureInstance(ctx, 'stale');
        stale.lastSeen = new Date(Date.now() - 100_000).toISOString();
        ensureInstance(ctx, 'fresh');

        const removed = pruneStaleInstances(ctx, 90_000);

        expect(removed).toEqual(['stale']);
        expect(ctx.instances.has('stale')).toBe(false);
        expect(ctx.instances.has('fresh')).toBe(true);
    });

    it('uses defaultPruneMaxAgeMs when not specified', () => {
        const stale = ensureInstance(ctx, 'stale');
        stale.lastSeen = new Date(Date.now() - (defaultPruneMaxAgeMs + 1000)).toISOString();

        const removed = pruneStaleInstances(ctx);
        expect(removed).toContain('stale');
    });

    it('keeps recently active instances', () => {
        ensureInstance(ctx, 'a');
        ensureInstance(ctx, 'b');

        const removed = pruneStaleInstances(ctx, 60_000);
        expect(removed).toEqual([]);
        expect(ctx.instances.size).toBe(2);
    });

    it('returns empty array when no instances registered', () => {
        expect(pruneStaleInstances(ctx)).toEqual([]);
    });
});

describe('listInstances', () => {
    it('returns array of InstanceState (without buffer)', () => {
        const ctx = createContext();
        ensureInstance(ctx, 'tab-1', {url: '/login', title: 'Login'});
        ensureInstance(ctx, 'tab-2', {url: '/home', title: 'Home'});

        const list = listInstances(ctx);
        expect(list).toHaveLength(2);
        for (const item of list) {
            expect(item).not.toHaveProperty('buffer');
        }
        const ids = list.map((s) => s.id).sort();
        expect(ids).toEqual(['tab-1', 'tab-2']);
        expect(list.find((s) => s.id === 'tab-1')?.url).toBe('/login');
    });

    it('returns empty array when no instances', () => {
        const ctx = createContext();
        expect(listInstances(ctx)).toEqual([]);
    });
});

describe('handleInstanceRegister', () => {
    it('creates instance with url/title from envelope', () => {
        const ctx = createContext();
        handleInstanceRegister(
            {id: 'tab-1', url: 'http://localhost/login', title: 'Login', ts: '2026-01-01T00:00:00.000Z'},
            ctx,
        );
        const inst = ctx.instances.get('tab-1');
        expect(inst).toBeDefined();
        expect(inst?.url).toBe('http://localhost/login');
        expect(inst?.title).toBe('Login');
    });

    it('updates meta on subsequent register (e.g. after popstate)', () => {
        const ctx = createContext();
        handleInstanceRegister({id: 'tab-1', url: '/old', title: 'Old'}, ctx);
        handleInstanceRegister({id: 'tab-1', url: '/new', title: 'New'}, ctx);
        const inst = ctx.instances.get('tab-1');
        expect(inst?.url).toBe('/new');
        expect(inst?.title).toBe('New');
    });

    it('ignores malformed payloads without throwing', () => {
        const ctx = createContext();
        expect(() => handleInstanceRegister({url: '/x'}, ctx)).not.toThrow();
        expect(() => handleInstanceRegister(null, ctx)).not.toThrow();
        expect(() => handleInstanceRegister('plain', ctx)).not.toThrow();
        expect(ctx.instances.size).toBe(0);
    });
});

describe('handleInstanceHeartbeat', () => {
    it('creates instance on first heartbeat and updates lastSeen on subsequent', async () => {
        const ctx = createContext();
        handleInstanceHeartbeat({id: 'tab-1', ts: '2026-01-01T00:00:00.000Z'}, ctx);
        const first = ctx.instances.get('tab-1')?.lastSeen;
        expect(first).toBeDefined();

        await new Promise((r) => setTimeout(r, 5));
        handleInstanceHeartbeat({id: 'tab-1', ts: '2026-01-01T00:00:01.000Z'}, ctx);
        const second = ctx.instances.get('tab-1')?.lastSeen;
        expect(second).not.toBe(first);
    });

    it('ignores malformed payloads without throwing', () => {
        const ctx = createContext();
        expect(() => handleInstanceHeartbeat({}, ctx)).not.toThrow();
        expect(() => handleInstanceHeartbeat(null, ctx)).not.toThrow();
        expect(ctx.instances.size).toBe(0);
    });
});
