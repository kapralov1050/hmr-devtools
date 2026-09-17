/**
 * Ring-buffer behaviour: `pushToBuffer` should append entries and, when the
 * buffer exceeds `maxEntries`, drop half and emit a `truncate` system marker.
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

describe('pushToBuffer (ring buffer)', () => {
    let ctx: ReturnType<typeof createContext>;

    beforeEach(() => {
        ctx = createContext();
    });

    it('appends entries verbatim while under the limit', () => {
        pushToBuffer(ctx, entry('a'));
        pushToBuffer(ctx, entry('b'));
        pushToBuffer(ctx, entry('c'));

        expect(ctx.buffer).toHaveLength(3);
        expect(ctx.buffer.map((e) => e.msg)).toEqual(['a', 'b', 'c']);
    });

    it('truncates half and adds a `truncate` marker when maxEntries is exceeded', () => {
        for (let i = 0; i < maxEntries; i++) {
            ctx.buffer.push(entry(`init-${i}`));
        }

        pushToBuffer(ctx, entry('overflow'));

        const overflowLength = maxEntries + 1;
        const dropCount = Math.floor(overflowLength / 2);
        expect(ctx.buffer.length).toBe(overflowLength - dropCount + 1);

        const firstSurvivor = ctx.buffer[0];
        expect(firstSurvivor).toBeDefined();
        expect(firstSurvivor?.msg).toBe(`init-${dropCount}`);

        const last = ctx.buffer[ctx.buffer.length - 1];
        expect(last).toBeDefined();
        expect(last?.type).toBe('truncate');
        expect(last?.level).toBe('info');
    });

    it('keeps buffer length bounded across multiple overflows', () => {
        for (let i = 0; i < 2 * maxEntries + 10; i++) {
            pushToBuffer(ctx, entry(`e-${i}`));
        }

        expect(ctx.buffer.length).toBeLessThanOrEqual(maxEntries + 1);
        expect(ctx.buffer.length).toBeGreaterThan(maxEntries / 2);
    });
});
