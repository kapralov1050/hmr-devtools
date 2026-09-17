/**
 * Tests for devLogger/execChannel.ts — verifies the safeSerialize + withTimeout
 * chain correctly emits `{ok:false, error}` via sender on serialization
 * failure / throws inside the IIFE.
 *
 * We use the exported `makeDevExecHandler(send)` factory and pass a vi.fn()
 * as sender — this avoids mocking `import.meta.hot` (which is awkward in
 * vitest+jsdom) while keeping the production glue (`initDevExec`) untouched.
 */
import {describe, expect, it, vi} from 'vitest';
import {defaultExecTimeoutMs} from '../src/client/constants';
import {makeDevExecHandler} from '../src/client/channels/execChannel';

describe('makeDevExecHandler', () => {
    it('emits ok:true with serialized value for successful quick execution', async () => {
        const send = vi.fn();
        const handler = makeDevExecHandler(send);

        await handler({id: 'req-1', code: 'return 2 + 3'});

        expect(send).toHaveBeenCalledTimes(1);
        const [event, payload] = send.mock.calls[0] as [string, {id: string; ok: boolean; value: string}];
        expect(event).toBe('dev-exec-result');
        expect(payload.id).toBe('req-1');
        expect(payload.ok).toBe(true);
        expect(payload.value).toBe('5');
    });

    it('emits ok:false with cyclic error when result contains a cycle', async () => {
        const send = vi.fn();
        const handler = makeDevExecHandler(send);

        (globalThis as Record<string, unknown>).__cycleTest = {name: 'root'};
        const cycleObj = (globalThis as Record<string, unknown>).__cycleTest as Record<string, unknown>;
        cycleObj.self = cycleObj;

        try {
            await handler({id: 'req-cycle', code: 'return globalThis.__cycleTest'});

            expect(send).toHaveBeenCalledTimes(1);
            const [, payload] = send.mock.calls[0] as [string, {id: string; ok: boolean; error: string; hint?: string}];
            expect(payload.id).toBe('req-cycle');
            expect(payload.ok).toBe(false);
            expect(payload.error).toBe('Cyclic structure');
            expect(payload.hint).toMatch(/replacer|circular/i);
        } finally {
            delete (globalThis as Record<string, unknown>).__cycleTest;
        }
    });

    it('emits ok:false with execution-error message when the IIFE throws', async () => {
        const send = vi.fn();
        const handler = makeDevExecHandler(send);

        await handler({id: 'req-throw', code: 'throw new Error("boom");'});

        expect(send).toHaveBeenCalledTimes(1);
        const [, payload] = send.mock.calls[0] as [string, {id: string; ok: boolean; error: string}];
        expect(payload.id).toBe('req-throw');
        expect(payload.ok).toBe(false);
        expect(payload.error).toMatch(/boom/);
    });

    it('serializes undefined return as empty string (JSON.stringify semantics)', async () => {
        const send = vi.fn();
        const handler = makeDevExecHandler(send);

        await handler({id: 'req-undef', code: 'return undefined'});

        expect(send).toHaveBeenCalledTimes(1);
        const [, payload] = send.mock.calls[0] as [string, {id: string; ok: boolean; value: string}];
        expect(payload.id).toBe('req-undef');
        expect(payload.ok).toBe(true);
        expect(payload.value).toBe('');
    });

    it('emits ok:true with truncation marker when result exceeds maxBytes', async () => {
        const send = vi.fn();
        const handler = makeDevExecHandler(send);

        await handler({id: 'req-huge', code: 'return {blob: "x".repeat(200000)}'});

        expect(send).toHaveBeenCalledTimes(1);
        const [, payload] = send.mock.calls[0] as [string, {id: string; ok: boolean; value: string}];
        expect(payload.id).toBe('req-huge');
        expect(payload.ok).toBe(true);
        const parsed = JSON.parse(payload.value) as {__truncated__: boolean};
        expect(parsed.__truncated__).toBe(true);
    });

    it('ignores malformed payloads without sending a response', async () => {
        const send = vi.fn();
        const handler = makeDevExecHandler(send);

        const badInputs: unknown[] = [null, undefined, 'plain', 42, {}, {id: 1}, {code: 'x'}, {id: 'a', code: 5}];
        for (const bad of badInputs) {
            await handler(bad);
        }
        expect(send).not.toHaveBeenCalled();
    });

    it('emits ok:false with timeout error when IIFE runs longer than defaultExecTimeoutMs', async () => {
        const send = vi.fn();
        const handler = makeDevExecHandler(send);

        await handler({id: 'req-tmo', code: 'await new Promise(() => {})'});

        expect(send).toHaveBeenCalledTimes(1);
        const [, payload] = send.mock.calls[0] as [string, {id: string; ok: boolean; error: string}];
        expect(payload.id).toBe('req-tmo');
        expect(payload.ok).toBe(false);
        expect(payload.error).toMatch(/timed out/i);
        expect(payload.error).toMatch(new RegExp(`timed out after ${defaultExecTimeoutMs}ms`));
    });
});
