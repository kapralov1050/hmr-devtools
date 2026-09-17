/**
 * Tests for devLogger/core/serialize.ts.
 */
import {describe, expect, it} from 'vitest';
import {defaultMaxSerializedBytes} from '../devLogger/constants';
import {safeSerialize, truncatePreview} from '../devLogger/core/serialize';

describe('safeSerialize', () => {
    it('serializes a simple object with ok=true and expected fields', () => {
        const result = safeSerialize({a: 1, b: 'two', c: [3, 4]});
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const parsed = JSON.parse(result.value) as {a: number; b: string; c: number[]};
        expect(parsed.a).toBe(1);
        expect(parsed.b).toBe('two');
        expect(parsed.c).toEqual([3, 4]);
    });

    it('serializes primitives', () => {
        const r1 = safeSerialize(42);
        expect(r1.ok).toBe(true);
        if (r1.ok) expect(r1.value).toBe('42');

        const r2 = safeSerialize('hello');
        expect(r2.ok).toBe(true);
        if (r2.ok) expect(r2.value).toBe('"hello"');

        const r3 = safeSerialize(null);
        expect(r3.ok).toBe(true);
        if (r3.ok) expect(r3.value).toBe('null');
    });

    it('returns ok=false for cyclic structures', () => {
        const obj: Record<string, unknown> = {name: 'root'};
        obj.self = obj;
        const result = safeSerialize(obj);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error).toBe('Cyclic structure');
        expect(result.hint).toMatch(/replacer|circular/);
    });

    it('detects indirect cycles', () => {
        const a: Record<string, unknown> = {x: 1};
        const b: Record<string, unknown> = {a};
        a.b = b;
        const result = safeSerialize(a);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error).toBe('Cyclic structure');
    });

    it('serializes Map as tagged __type: Map with entries', () => {
        const m = new Map<string, unknown>([
            ['k1', 1],
            ['k2', 'v2'],
        ]);
        const result = safeSerialize(m);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const parsed = JSON.parse(result.value) as {__type: string; entries: Array<[string, unknown]>};
        expect(parsed.__type).toBe('Map');
        expect(parsed.entries).toEqual([
            ['k1', 1],
            ['k2', 'v2'],
        ]);
    });

    it('serializes Set as tagged __type: Set with values', () => {
        const s = new Set([1, 2, 3]);
        const result = safeSerialize(s);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const parsed = JSON.parse(result.value) as {__type: string; values: number[]};
        expect(parsed.__type).toBe('Set');
        expect(parsed.values).toEqual([1, 2, 3]);
    });

    it('serializes BigInt as tagged __type: BigInt with string value', () => {
        const result = safeSerialize({big: 12345678901234567890n});
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const parsed = JSON.parse(result.value) as {big: {__type: string; value: string}};
        expect(parsed.big.__type).toBe('BigInt');
        expect(parsed.big.value).toBe('12345678901234567890');
    });

    it('serializes Symbol as tagged __type: Symbol with description', () => {
        const result = safeSerialize({s: Symbol('my-sym')});
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const parsed = JSON.parse(result.value) as {s: {__type: string; description: string}};
        expect(parsed.s.__type).toBe('Symbol');
        expect(parsed.s.description).toBe('my-sym');
    });

    it('serializes Function as tagged __type: Function with name', () => {
        function myFn() {
            return 1;
        }
        const result = safeSerialize({fn: myFn});
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const parsed = JSON.parse(result.value) as {fn: {__type: string; name: string}};
        expect(parsed.fn.__type).toBe('Function');
        expect(parsed.fn.name).toBe('myFn');
    });

    it('uses anonymous for truly unnamed functions (arrow)', () => {
        const fn = (() => () => 1)();
        const result = safeSerialize(fn);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const parsed = JSON.parse(result.value) as {__type: string; name: string};
        expect(parsed.__type).toBe('Function');
        expect(parsed.name).toBe('anonymous');
    });

    it('truncates value exceeding maxBytes', () => {
        const big = {blob: 'x'.repeat(2048)};
        const result = safeSerialize(big, 256);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const parsed = JSON.parse(result.value) as {
            __truncated__: boolean;
            sizeBytes: number;
            preview: string;
            maxBytes: number;
        };
        expect(parsed.__truncated__).toBe(true);
        expect(parsed.maxBytes).toBe(256);
        expect(typeof parsed.preview).toBe('string');
        // preview is the first 256 chars of JSON.stringify(value) (not the whole payload)
        expect(parsed.preview.length).toBe(256);
        expect(parsed.preview.endsWith('…<truncated at 256 bytes>')).toBe(true);
    });

    it('respects default maxBytes when not specified', () => {
        // Construct value that serialized would exceed default cap.
        const big = 'a'.repeat(defaultMaxSerializedBytes + 16);
        const result = safeSerialize({big});
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const parsed = JSON.parse(result.value) as {__truncated__?: boolean};
        expect(parsed.__truncated__).toBe(true);
    });

    it('does not truncate value just under maxBytes', () => {
        const small = {ok: true};
        const result = safeSerialize(small, 1024);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const parsed = JSON.parse(result.value) as {__truncated__?: boolean; ok?: boolean};
        expect(parsed.__truncated__).toBeUndefined();
        expect(parsed.ok).toBe(true);
    });

    it('handles undefined as JSON-empty ok:true', () => {
        const result = safeSerialize(undefined);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value).toBe('');
    });

    it('handles nested mixed structures', () => {
        const data = {
            name: 'root',
            tags: new Set(['a', 'b']),
            counts: new Map([['x', 1]]),
            child: {
                fn: function inner() {
                    return null;
                },
                big: 9007199254740993n,
            },
        };
        const result = safeSerialize(data);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const parsed = JSON.parse(result.value) as {
            name: string;
            tags: {__type: string; values: string[]};
            counts: {__type: string; entries: Array<[string, number]>};
            child: {fn: {__type: string}; big: {__type: string; value: string}};
        };
        expect(parsed.name).toBe('root');
        expect(parsed.tags.__type).toBe('Set');
        expect(parsed.counts.__type).toBe('Map');
        expect(parsed.child.fn.__type).toBe('Function');
        expect(parsed.child.big.__type).toBe('BigInt');
    });
});

describe('truncatePreview', () => {
    it('returns full JSON when under limit', () => {
        const out = truncatePreview({a: 1}, 1024);
        expect(out).toBe('{"a":1}');
    });

    it('truncates and appends marker when over limit', () => {
        const out = truncatePreview({blob: 'x'.repeat(200)}, 64);
        expect(out.length).toBeLessThanOrEqual(64 + 32);
        expect(out).toMatch(/truncated at 64 bytes/);
    });

    it('handles Map through replacer', () => {
        const m = new Map<string, number>([['a', 1]]);
        const out = truncatePreview(m, 1024);
        expect(out).toContain('"__type":"Map"');
    });
});
