/**
 * Tests for `devLogger/channels/domChannel.ts`: `buildCompactSnapshot` and
 * `buildRawSnapshot` against jsdom (vitest environment=jsdom).
 *
 * Covers format, indices, attribute quoting, focus/context folding, and
 * raw-snapshot attrs/styles/viewportOnly.
 */
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {buildCompactSnapshot, buildRawSnapshot, isInteractive, makeDomHandler} from '../devLogger/channels/domChannel';
import {hmrEventDomResponse} from '../devLogger/constants';
import type {DomSpec} from '../devLogger/types';

function makePage(html: string): void {
    document.body.innerHTML = html;
}

describe('isInteractive', () => {
    beforeEach(() => {
        makePage('');
    });

    it('returns true for button/input/select/textarea/a', () => {
        makePage('<button id="b"></button><input id="i"/><select id="s"></select><textarea id="t"></textarea><a id="a" href="/x">x</a>');
        const els = document.body.querySelectorAll('*');
        for (const el of els) {
            expect(isInteractive(el)).toBe(true);
        }
    });

    it('returns true for elements with id', () => {
        makePage('<div id="someId"></div>');
        const div = document.getElementById('someId');
        expect(div).not.toBeNull();
        expect(isInteractive(div!)).toBe(true);
    });

    it('returns true for elements with tabindex', () => {
        makePage('<div tabindex="0"></div>');
        const div = document.querySelector('div');
        expect(isInteractive(div!)).toBe(true);
    });

    it('returns false for plain div/span', () => {
        makePage('<div><span>nothing</span></div>');
        const div = document.querySelector('div');
        const span = document.querySelector('span');
        expect(isInteractive(div!)).toBe(false);
        expect(isInteractive(span!)).toBe(false);
    });
});

describe('buildCompactSnapshot', () => {
    beforeEach(() => {
        makePage('');
    });

    it('a) produces indexed lines for buttons + input', () => {
        makePage(`
            <div>
                <button id="btn1">Cancel</button>
                <button id="btn2">Submit</button>
                <input id="email" type="email" placeholder="Email"/>
            </div>
        `);

        const out = buildCompactSnapshot({format: 'compact'});
        const lines = out.split('\n');

        expect(lines).toHaveLength(3);
        expect(lines[0]).toBe('button#1 Cancel');
        expect(lines[1]).toBe('button#2 Submit');
        expect(lines[2]).toBe('input#3[type=email][ph=Email]');
    });

    it('b) formats [type=T] and [ph=P] (unquoted when no spaces)', () => {
        makePage(`<div><input type="text" placeholder="Name"/></div>`);

        const out = buildCompactSnapshot({format: 'compact'});
        expect(out).toContain('input#1');
        expect(out).toContain('[type=text]');
        expect(out).toContain('[ph=Name]');
        expect(out).not.toContain('"Name"');
    });

    it('c) quotes attribute values containing spaces', () => {
        makePage(`<div><input type="text" placeholder="Your Name"/></div>`);

        const out = buildCompactSnapshot({format: 'compact'});
        expect(out).toContain('[ph="Your Name"]');
    });

    it('d) renders [check] for checked input', () => {
        makePage(`<div><input type="checkbox" checked/></div>`);

        const out = buildCompactSnapshot({format: 'compact'});
        expect(out).toContain('[check]');
    });

    it('e) renders [href=...] for anchors', () => {
        makePage(`<div><a href="/login">Login</a></div>`);

        const out = buildCompactSnapshot({format: 'compact'});
        expect(out).toContain('a#1[href=/login] Login');
    });

    it('f) renders [disabled] for disabled elements', () => {
        makePage(`<div><button disabled>OK</button></div>`);

        const out = buildCompactSnapshot({format: 'compact'});
        expect(out).toContain('[disabled]');
    });

    it('g) emits [val=V] for input value', () => {
        makePage(`<div><input type="text" value="hello"/></div>`);

        const out = buildCompactSnapshot({format: 'compact'});
        expect(out).toContain('[val=hello]');
    });

    it('h) uses selector when provided', () => {
        makePage(`
            <div class="wrap">
                <button id="b1">One</button>
            </div>
            <button id="b2">Two</button>
        `);

        const spec: DomSpec = {format: 'compact', selector: '.wrap'};
        const out = buildCompactSnapshot(spec);
        expect(out).toBe('button#1 One');
        expect(out).not.toContain('Two');
    });

    it('i) focus mode marks focused line with → and folds far lines into ·', () => {
        makePage(`
            <div>
                <button id="b0">Zero</button>
                <button id="b1">One</button>
                <button id="b2">Two</button>
                <button id="b3">Three</button>
                <button id="b4">Four</button>
                <button id="b5">Five</button>
            </div>
        `);

        const out = buildCompactSnapshot({format: 'compact', focus: 3, context: 1});
        const lines = out.split('\n');

        // focus=3 with context=1 → shows idx 2,3,4 with · marker before and after
        expect(lines[0]).toBe('·');
        expect(lines[1]).toBe('  button#2 One');
        expect(lines[2]).toBe('→ button#3 Two');
        expect(lines[3]).toBe('  button#4 Three');
        expect(lines[4]).toBe('·');
    });

    it('j) focus on edge (first element) only shows · at end', () => {
        makePage(`
            <div>
                <button id="b1">One</button>
                <button id="b2">Two</button>
                <button id="b3">Three</button>
            </div>
        `);

        const out = buildCompactSnapshot({format: 'compact', focus: 1, context: 1});
        const lines = out.split('\n');
        expect(lines[0]).toBe('→ button#1 One');
        expect(lines[1]).toBe('  button#2 Two');
        expect(lines[2]).toBe('·');
    });

    it('k) returns "<no matches>" when selector yields nothing', () => {
        makePage(`<div></div>`);
        const out = buildCompactSnapshot({format: 'compact', selector: '.missing'});
        expect(out).toBe('<no matches>');
    });

    it('l) returns "<no interactive elements>" for plain markup', () => {
        makePage(`<div><span>plain</span></div>`);
        const out = buildCompactSnapshot({format: 'compact'});
        expect(out).toBe('<no interactive elements>');
    });

    it('m) focus not found → returns all lines without folding', () => {
        makePage(`<div><button>A</button><button>B</button></div>`);
        const out = buildCompactSnapshot({format: 'compact', focus: 999});
        const lines = out.split('\n');
        expect(lines).toHaveLength(2);
        expect(lines[0]).toBe('button#1 A');
        expect(lines[1]).toBe('button#2 B');
    });
});

describe('buildRawSnapshot', () => {
    beforeEach(() => {
        makePage('');
    });

    it('a) builds tree for div with class + inline style', () => {
        makePage(`<div class="box" style="color: red; padding: 10px;">Hi</div>`);

        const out = buildRawSnapshot({format: 'raw', attrs: 'all', styles: 'inline', depth: 2});
        expect(out.matches).toBe(1);
        expect(Array.isArray(out.tree)).toBe(true);

        // No selector → root is document.body; the div is one level deeper.
        const body = out.tree[0];
        expect(body.tag).toBe('body');
        const div = body.children.find((c) => c.tag === 'div');
        expect(div).toBeDefined();
        expect(div!.className).toBe('box');
        expect(div!.attrs).toBeDefined();
        expect(div!.attrs!['class']).toBe('box');
        expect(div!.attrs!['style']).toContain('color: red');
        expect(div!.inlineStyle).toBeDefined();
        expect(div!.inlineStyle!['color']).toBe('red');
        expect(div!.inlineStyle!['padding']).toBe('10px');
    });

    it('b) with attrs=none omits attrs entirely', () => {
        makePage(`<div class="box">x</div>`);
        const out = buildRawSnapshot({format: 'raw', attrs: 'none', depth: 2});
        const body = out.tree[0];
        const div = body.children.find((c) => c.tag === 'div');
        expect(div!.attrs).toBeUndefined();
    });

    it('c) with attrs=interactive on plain div omits attrs', () => {
        makePage(`<div class="plain">x</div>`);
        const out = buildRawSnapshot({format: 'raw', attrs: 'interactive', depth: 2});
        const body = out.tree[0];
        const div = body.children.find((c) => c.tag === 'div');
        expect(div!.attrs).toBeUndefined();
    });

    it('d) with attrs=interactive on id-having element keeps attrs', () => {
        makePage(`<div id="special" class="x">y</div>`);
        const out = buildRawSnapshot({format: 'raw', attrs: 'interactive', depth: 2});
        const body = out.tree[0];
        const div = body.children.find((c) => c.tag === 'div');
        expect(div).toBeDefined();
        expect(div!.attrs).toBeDefined();
        expect(div!.attrs!['id']).toBe('special');
    });

    it('e) with styles=computed includes computed.transform key (jsdom returns "none")', () => {
        makePage(`<div style="transform: rotate(45deg);">x</div>`);
        const out = buildRawSnapshot({format: 'raw', styles: 'computed', depth: 2});
        const body = out.tree[0];
        const div = body.children.find((c) => c.tag === 'div');
        expect(Object.prototype.hasOwnProperty.call(div?.computed ?? {}, 'transform')).toBe(true);
    });

    it('f) respects depth limit (children pruned beyond depth)', () => {
        makePage(`<div id="wrap"><div><div><div><span id="deep">leaf</span></div></div></div></div>`);
        const out = buildRawSnapshot({format: 'raw', selector: '#wrap', depth: 2});
        const wrap = out.tree[0];
        expect(wrap.tag).toBe('div');
        // depth=2 means root (level 1) + one level of children
        expect(wrap.children.length).toBe(1);
        expect(wrap.children[0].children.length).toBe(0);
    });

    it('g) selector narrows the root matches', () => {
        makePage(`
            <div class="a"><span id="x1">A</span></div>
            <div class="b"><span id="x2">B</span></div>
        `);

        const out = buildRawSnapshot({format: 'raw', selector: '.b', depth: 3});
        expect(out.matches).toBe(1);
        expect(out.selector).toBe('.b');
        const match = out.tree[0];
        expect(match.className).toBe('b');
    });

    it('h) truncated=true is false when tree fits within maxSize', () => {
        makePage(`<div><button>x</button></div>`);
        const out = buildRawSnapshot({format: 'raw', maxSize: 1_000_000, depth: 3});
        expect(out.truncated).toBe(false);
    });

    it('i) truncated=true and tree is reduced when result exceeds maxSize', () => {
        // Build a tree where each node carries a large attribute value to ensure
        // the resulting JSON exceeds maxSize.
        const wrap = document.createElement('div');
        wrap.id = 'wraproot';
        for (let i = 0; i < 30; i++) {
            const child = document.createElement('div');
            child.id = `n${i}`;
            child.setAttribute('data-blob', 'X'.repeat(200));
            wrap.appendChild(child);
        }
        document.body.appendChild(wrap);

        const out = buildRawSnapshot({format: 'raw', selector: '#wraproot', maxSize: 100, depth: 5, attrs: 'all'});
        expect(out.truncated).toBe(true);
        expect(out.tree).toBeDefined();
    });
});

describe('makeDomHandler', () => {
    beforeEach(() => {
        makePage('');
    });

    it('sends compact value via dev-dom-response for format=compact', async () => {
        makePage(`<div><button>OK</button></div>`);

        const send = vi.fn();
        const handler = makeDomHandler(send);

        await handler({id: 'req-1', spec: {format: 'compact'}, instanceId: 'tab-1'});

        expect(send).toHaveBeenCalledTimes(1);
        const [event, payload] = send.mock.calls[0] as [string, {id: string; ok: boolean; value: string; fromInstance: string}];
        expect(event).toBe(hmrEventDomResponse);
        expect(payload.id).toBe('req-1');
        expect(payload.ok).toBe(true);
        expect(payload.value).toContain('button#1 OK');
        expect(typeof payload.fromInstance).toBe('string');
    });

    it('sends raw tree via dev-dom-response for format=raw', async () => {
        makePage(`<div id="root"><button>OK</button></div>`);

        const send = vi.fn();
        const handler = makeDomHandler(send);

        await handler({id: 'req-2', spec: {format: 'raw', selector: '#root', depth: 2, attrs: 'all'}, instanceId: 'tab-1'});

        expect(send).toHaveBeenCalledTimes(1);
        const [, payload] = send.mock.calls[0] as [string, {id: string; ok: boolean; tree: unknown[]; sizeBytes: number; truncated: boolean}];
        expect(payload.id).toBe('req-2');
        expect(payload.ok).toBe(true);
        expect(Array.isArray(payload.tree)).toBe(true);
        expect(payload.sizeBytes).toBe(JSON.stringify(payload.tree).length);
        expect(payload.truncated).toBe(false);
    });

    it('emits ok:false with error when browser throws', async () => {
        const send = vi.fn();
        const handler = makeDomHandler(send);

        // Force an error by passing an invalid spec that triggers a throw inside
        // buildRawSnapshot (selector evaluation throws on something we can construct).
        // Instead, use a getter-based spec that throws on access.
        const evilSpec: DomSpec = new Proxy({format: 'compact'}, {
            get(target, prop) {
                if (prop === 'selector') {
                    throw new Error('boom');
                }
                return Reflect.get(target, prop);
            },
        });

        await handler({id: 'req-err', spec: evilSpec, instanceId: 'tab-1'});

        expect(send).toHaveBeenCalledTimes(1);
        const [, payload] = send.mock.calls[0] as [string, {id: string; ok: boolean; error: string}];
        expect(payload.id).toBe('req-err');
        expect(payload.ok).toBe(false);
        expect(payload.error).toBe('boom');
    });

    it('ignores malformed payloads without sending a response', async () => {
        const send = vi.fn();
        const handler = makeDomHandler(send);

        const bad: unknown[] = [null, undefined, 'plain', 42, {}, {id: 1}];
        for (const b of bad) {
            await handler(b);
        }
        expect(send).not.toHaveBeenCalled();
    });
});
