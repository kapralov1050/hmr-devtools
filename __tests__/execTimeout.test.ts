/**
 * Tests for devLogger/core/execTimeout.ts.
 */
import {describe, expect, it} from 'vitest';
import {ExecTimeoutError, withTimeout} from '../src/client/core/execTimeout';

describe('withTimeout', () => {
    it('resolves when the inner promise resolves before timeout', async () => {
        const result = await withTimeout(Promise.resolve('ok'), 1000);
        expect(result).toBe('ok');
    });

    it('rejects with ExecTimeoutError when inner promise is slower than timeout', async () => {
        const slow = new Promise<string>((resolve) => {
            setTimeout(() => resolve('too-late'), 100);
        });
        await expect(withTimeout(slow, 50)).rejects.toBeInstanceOf(ExecTimeoutError);
    });

    it('the timeout error has a descriptive message mentioning the ms value', async () => {
        const slow = new Promise<number>((resolve) => {
            setTimeout(() => resolve(1), 200);
        });
        try {
            await withTimeout(slow, 25);
            throw new Error('expected rejection');
        } catch (e) {
            expect(e).toBeInstanceOf(ExecTimeoutError);
            const err = e as ExecTimeoutError;
            expect(err.timeoutMs).toBe(25);
            expect(err.message).toMatch(/timed out after 25ms/);
        }
    });

    it('propagates the inner rejection when it happens before timeout', async () => {
        const inner = new Error('inner-failure');
        await expect(withTimeout(Promise.reject(inner), 1000)).rejects.toBe(inner);
    });

    it('wraps non-Error inner rejection into Error', async () => {
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
        await expect(withTimeout(Promise.reject('plain-string'), 1000)).rejects.toBeInstanceOf(Error);
    });

    it('rejects immediately when timeoutMs <= 0', async () => {
        await expect(withTimeout(Promise.resolve(1), 0)).rejects.toBeInstanceOf(ExecTimeoutError);
        await expect(withTimeout(Promise.resolve(1), -1)).rejects.toBeInstanceOf(ExecTimeoutError);
    });

    it('passes through hint to ExecTimeoutError', async () => {
        const slow = new Promise<number>((resolve) => {
            setTimeout(() => resolve(1), 100);
        });
        try {
            await withTimeout(slow, 20, 'use less data');
            throw new Error('expected rejection');
        } catch (e) {
            expect(e).toBeInstanceOf(ExecTimeoutError);
            expect((e as ExecTimeoutError).hint).toBe('use less data');
        }
    });
});
