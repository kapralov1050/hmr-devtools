/**
 * Tests for `devLogger/channels/instanceReg.ts`: instanceId generation/caching
 * and `setupInstanceReg` (pure factory with injected deps).
 */
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {
    _resetInstanceIdCache,
    generateInstanceId,
    getInstanceId,
    initInstanceReg,
    setupInstanceReg,
} from '../src/client/channels/instanceReg';
import {
    defaultInstanceHeartbeatMs,
    hmrEventInstanceHeartbeat,
    hmrEventInstanceRegister,
} from '../src/client/constants';

describe('generateInstanceId', () => {
    it('returns a non-empty string', () => {
        const id = generateInstanceId();
        expect(typeof id).toBe('string');
        expect(id.length).toBeGreaterThan(0);
    });

    it('contains a timestamp prefix', () => {
        const id = generateInstanceId();
        expect(id).toMatch(/^\d+-[a-z0-9]+$/);
    });

    it('generates unique ids', () => {
        const ids = new Set<string>();
        for (let i = 0; i < 20; i++) {
            ids.add(generateInstanceId());
        }
        expect(ids.size).toBe(20);
    });
});

describe('getInstanceId', () => {
    afterEach(() => {
        _resetInstanceIdCache();
    });

    it('returns the same id on repeated calls (cache)', () => {
        const id1 = getInstanceId();
        const id2 = getInstanceId();
        const id3 = getInstanceId();
        expect(id1).toBe(id2);
        expect(id2).toBe(id3);
    });

    it('generates a new id after cache reset', () => {
        const id1 = getInstanceId();
        _resetInstanceIdCache();
        const id2 = getInstanceId();
        expect(id1).not.toBe(id2);
    });
});

describe('setupInstanceReg', () => {
    let send: ReturnType<typeof vi.fn>;
    let onDispose: ReturnType<typeof vi.fn>;
    let addPopstateListener: ReturnType<typeof vi.fn>;
    let popstateUnsub: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        _resetInstanceIdCache();
        send = vi.fn();
        onDispose = vi.fn();
        popstateUnsub = vi.fn();
        addPopstateListener = vi.fn().mockReturnValue(popstateUnsub);
    });

    afterEach(() => {
        _resetInstanceIdCache();
        vi.useRealTimers();
    });

    it('sends a register envelope immediately on init with current url/title/ts', () => {
        setupInstanceReg({
            send,
            onDispose,
            addPopstateListener,
            getUrl: () => 'http://localhost/login',
            getTitle: () => 'Login Page',
            heartbeatMs: 60_000,
            now: () => '2026-01-01T00:00:00.000Z',
        });

        expect(send).toHaveBeenCalledTimes(1);
        const [event, payload] = send.mock.calls[0] as [string, {id: string; url: string; title: string; ts: string}];
        expect(event).toBe(hmrEventInstanceRegister);
        expect(payload.url).toBe('http://localhost/login');
        expect(payload.title).toBe('Login Page');
        expect(payload.ts).toBe('2026-01-01T00:00:00.000Z');
        expect(payload.id.length).toBeGreaterThan(0);
    });

    it('registers popstate listener and resubscribes via HMR-dispose', () => {
        setupInstanceReg({
            send,
            onDispose,
            addPopstateListener,
            getUrl: () => 'http://localhost/',
            getTitle: () => '',
            heartbeatMs: 60_000,
            now: () => new Date().toISOString(),
        });

        expect(addPopstateListener).toHaveBeenCalledTimes(1);
        expect(onDispose).toHaveBeenCalledTimes(1);
    });

    it('re-sends register envelope when popstate fires', () => {
        let popCb: (() => void) | null = null;
        addPopstateListener.mockImplementation((cb: () => void) => {
            popCb = cb;
            return vi.fn();
        });

        setupInstanceReg({
            send,
            onDispose,
            addPopstateListener,
            getUrl: vi.fn()
                .mockReturnValueOnce('http://localhost/old')
                .mockReturnValueOnce('http://localhost/new'),
            getTitle: () => 'T',
            heartbeatMs: 60_000,
            now: () => new Date().toISOString(),
        });

        expect(send).toHaveBeenCalledTimes(1);
        const before = send.mock.calls[0] as [string, {url: string}];
        expect(before[1].url).toBe('http://localhost/old');

        popCb!();

        expect(send).toHaveBeenCalledTimes(2);
        const after = send.mock.calls[1] as [string, {url: string}];
        expect(after[1].url).toBe('http://localhost/new');
    });

    it('dispose clears timer and unsubscribes from popstate (no double cleanup)', () => {
        const handle = setupInstanceReg({
            send,
            onDispose,
            addPopstateListener,
            getUrl: () => '',
            getTitle: () => '',
            heartbeatMs: 60_000,
            now: () => new Date().toISOString(),
        });

        handle.dispose();
        expect(popstateUnsub).toHaveBeenCalledTimes(1);

        // Calling dispose again is a no-op
        handle.dispose();
        expect(popstateUnsub).toHaveBeenCalledTimes(1);
    });

    it('sends heartbeat via setInterval', () => {
        vi.useFakeTimers();
        setupInstanceReg({
            send,
            onDispose,
            addPopstateListener,
            getUrl: () => '',
            getTitle: () => '',
            heartbeatMs: 100,
            now: () => new Date().toISOString(),
        });

        expect(send).toHaveBeenCalledTimes(1); // initial register
        vi.advanceTimersByTime(100);
        expect(send).toHaveBeenCalledTimes(2); // 1 heartbeat
        const hb = send.mock.calls[1] as [string, {id: string}];
        expect(hb[0]).toBe(hmrEventInstanceHeartbeat);
        expect(hb[1].id.length).toBeGreaterThan(0);
    });

    it('uses defaultInstanceHeartbeatMs constant as documented default', () => {
        expect(defaultInstanceHeartbeatMs).toBe(30_000);
    });
});

describe('initInstanceReg', () => {
    afterEach(() => {
        _resetInstanceIdCache();
        vi.useRealTimers();
    });

    it('is a no-op when import.meta.hot is undefined (jsdom default)', () => {
        // In vitest+jsdom env, import.meta.hot is undefined, so initInstanceReg returns early.
        expect(() => initInstanceReg()).not.toThrow();
    });
});
