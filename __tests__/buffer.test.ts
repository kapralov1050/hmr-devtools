/**
 * Ring-buffer behaviour: `pushToBuffer` should append entries per-instance and,
 * when a buffer exceeds `maxEntries`, drop half and emit a `truncate` system marker.
 *
 * `defaultMaxEntries` (from `devLogger/constants.ts`) is 5000, so we exhaust the
 * path via direct array manipulation rather than pushing 5001 entries.
 */
import {beforeEach, describe, expect, it} from 'vitest';
import {defaultMaxEntries as maxEntries} from '../devLogger/constants';
import type {LogPayload} from '../devLogger/types';
import {pushToBuffer} from '../devBrowserLogs/logs';
import {createContext} from './helpers';

function entry(msg: string): LogPayload {
    return {ts: new Date().toISOString(), level: 'log', type: 'console', msg, url: ''};
}

describe('pushToBuffer (ring buffer, per-instance)', () => {
    let ctx: ReturnType<typeof createContext>;

    beforeEach(() => {
        ctx = createContext();
    });

    it('appends entries verbatim while under the limit', () => {
        pushToBuffer(ctx, 'tab-1', entry('a'));
        pushToBuffer(ctx, 'tab-1', entry('b'));
        pushToBuffer(ctx, 'tab-1', entry('c'));

        const buf = ctx.instances.get('tab-1')?.buffer ?? [];
        expect(buf).toHaveLength(3);
        expect(buf.map((e) => e.msg)).toEqual(['a', 'b', 'c']);
    });

    it('lazily creates the instance entry on first push', () => {
        pushToBuffer(ctx, 'lazy', entry('x'));
        expect(ctx.instances.has('lazy')).toBe(true);
    });

    it('truncates half and adds a `truncate` marker when maxEntries is exceeded', () => {
        const buf = ctx.instances.get('tab-1')?.buffer ?? (() => {
            pushToBuffer(ctx, 'tab-1', entry('init'));
            return ctx.instances.get('tab-1')!.buffer;
        })();

        for (let i = 0; i < maxEntries; i++) {
            buf.push(entry(`init-${i}`));
        }

        pushToBuffer(ctx, 'tab-1', entry('overflow'));

        const overflowLength = maxEntries + 1;
        const dropCount = Math.floor(overflowLength / 2);
        const after = ctx.instances.get('tab-1')?.buffer ?? [];
        expect(after.length).toBe(overflowLength - dropCount + 1);

        const firstSurvivor = after[0];
        expect(firstSurvivor).toBeDefined();
        expect(firstSurvivor?.msg).toBe(`init-${dropCount}`);

        const last = after[after.length - 1];
        expect(last).toBeDefined();
        expect(last?.type).toBe('truncate');
        expect(last?.level).toBe('info');
    });

    it('keeps buffer length bounded across multiple overflows', () => {
        for (let i = 0; i < 2 * maxEntries + 10; i++) {
            pushToBuffer(ctx, 'tab-1', entry(`e-${i}`));
        }

        const buf = ctx.instances.get('tab-1')?.buffer ?? [];
        expect(buf.length).toBeLessThanOrEqual(maxEntries + 1);
        expect(buf.length).toBeGreaterThan(maxEntries / 2);
    });
});
