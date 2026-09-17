/**
 * Tests for `devLogger/helpers/agentHelpers.ts` — global `__agent_*` helpers.
 *
 * Environment: jsdom (vitest default). Helpers are installed via
 * `installAgentHelpers()` and exercised through `globalThis.__agent_*`.
 */
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {
    _resetAgentHelpersState,
    __agent_click,
    __agent_clickByText,
    __agent_findByText,
    __agent_setValueByPlaceholder,
    __agent_snapshot,
    __agent_typeByPlaceholder,
    __agent_wait,
    __agent_waitFor,
    installAgentHelpers,
} from '../client/helpers/agentHelpers';

function makePage(html: string): void {
    document.body.innerHTML = html;
}

describe('installAgentHelpers', () => {
    afterEach(() => {
        _resetAgentHelpersState();
        const g = globalThis as Record<string, unknown>;
        delete g.__agent_snapshot;
        delete g.__agent_findByText;
        delete g.__agent_clickByText;
        delete g.__agent_click;
        delete g.__agent_setValueByPlaceholder;
        delete g.__agent_typeByPlaceholder;
        delete g.__agent_waitFor;
        delete g.__agent_wait;
    });

    it('a) globalThis.__agent_snapshot returns compact DOM as string array', () => {
        makePage(`<div><button id="b1">Save</button><button id="b2">Cancel</button></div>`);
        installAgentHelpers();

        const lines = (globalThis as unknown as {__agent_snapshot: (s?: string) => string[]}).__agent_snapshot();
        expect(lines).toEqual(['button#1 Save', 'button#2 Cancel']);
    });
});

describe('__agent_snapshot + __agent_click', () => {
    beforeEach(() => {
        _resetAgentHelpersState();
        makePage('');
    });

    afterEach(() => {
        _resetAgentHelpersState();
    });

    it('b) __agent_click(idx) clicks the indexed interactive element', async () => {
        makePage(`<div><button id="b1">One</button><button id="b2">Two</button></div>`);
        let clicked = '';
        document.getElementById('b2')?.addEventListener('click', () => {
            clicked = 'two';
        });

        const lines = __agent_snapshot();
        expect(lines).toHaveLength(2);

        const result = await __agent_click(2);
        expect(result).toEqual({clicked: true, idx: 2});
        expect(clicked).toBe('two');
    });

    it('c) __agent_click returns {clicked:false} for unknown idx', async () => {
        makePage(`<div><button>x</button></div>`);
        __agent_snapshot();

        const result = await __agent_click(999);
        expect(result.clicked).toBe(false);
    });
});

describe('__agent_clickByText', () => {
    beforeEach(() => {
        _resetAgentHelpersState();
        makePage('');
    });

    afterEach(() => {
        _resetAgentHelpersState();
    });

    it('d) finds button by text and clicks it; dispatches click event', async () => {
        makePage(`
            <div>
                <button id="cancel">Cancel</button>
                <button id="submit">Submit</button>
            </div>
        `);
        const submit = document.getElementById('submit') as HTMLButtonElement;
        let clicked = false;
        submit.addEventListener('click', () => {
            clicked = true;
        });

        const result = await __agent_clickByText('Submit');
        expect(result.clicked).toBe(true);
        expect(result.idx).toBe(2);
        expect(clicked).toBe(true);
    });

    it('e) returns {clicked:false} when text not found', async () => {
        makePage(`<div><button>Cancel</button></div>`);
        const result = await __agent_clickByText('Submit');
        expect(result).toEqual({clicked: false});
    });

    it('f) supports nth parameter to pick among multiple matches', async () => {
        makePage(`
            <div>
                <button id="a1">Save</button>
                <button id="a2">Save</button>
                <button id="a3">Save</button>
            </div>
        `);
        let secondClicked = false;
        document.getElementById('a2')?.addEventListener('click', () => {
            secondClicked = true;
        });

        const result = await __agent_clickByText('Save', 1);
        expect(result.clicked).toBe(true);
        expect(secondClicked).toBe(true);
    });
});

describe('__agent_findByText', () => {
    beforeEach(() => {
        _resetAgentHelpersState();
        makePage('');
    });

    afterEach(() => {
        _resetAgentHelpersState();
    });

    it('g) returns matches with idx/tag/text for elements containing substring', () => {
        makePage(`
            <div>
                <button>Hello World</button>
                <a id="link" href="/x">hello there</a>
            </div>
        `);

        const matches = __agent_findByText('hello');
        expect(matches).toHaveLength(2);
        expect(matches[0].tag).toBe('button');
        expect(matches[1].tag).toBe('a');
        expect(matches[0].idx).toBe(1);
        expect(matches[1].idx).toBe(2);
    });
});

describe('__agent_setValueByPlaceholder', () => {
    beforeEach(() => {
        _resetAgentHelpersState();
        makePage('');
    });

    afterEach(() => {
        _resetAgentHelpersState();
    });

    it('h) sets input.value and dispatches input event', async () => {
        makePage(`<form><input id="email" type="email" placeholder="Email"/></form>`);

        let inputEvents = 0;
        let changeEvents = 0;
        const input = document.getElementById('email') as HTMLInputElement;
        input.addEventListener('input', () => inputEvents++);
        input.addEventListener('change', () => changeEvents++);

        const result = await __agent_setValueByPlaceholder('Email', 'a@b.c');
        expect(result.set).toBe(true);
        expect(input.value).toBe('a@b.c');
        expect(inputEvents).toBe(1);
        expect(changeEvents).toBe(1);
    });

    it('i) works with textarea too', async () => {
        makePage(`<form><textarea id="msg" placeholder="Message"></textarea></form>`);

        const ta = document.getElementById('msg') as HTMLTextAreaElement;
        const result = await __agent_setValueByPlaceholder('Message', 'hello');
        expect(result.set).toBe(true);
        expect(ta.value).toBe('hello');
    });

    it('j) returns {set:false} for missing placeholder', async () => {
        makePage(`<form><input placeholder="Other"/></form>`);
        const result = await __agent_setValueByPlaceholder('Email', 'x');
        expect(result.set).toBe(false);
    });
});

describe('__agent_typeByPlaceholder', () => {
    beforeEach(() => {
        _resetAgentHelpersState();
        makePage('');
    });

    afterEach(() => {
        _resetAgentHelpersState();
    });

    it('k) sets value and dispatches Enter keydown', async () => {
        makePage(`<form><input id="search" placeholder="Search"/></form>`);
        const input = document.getElementById('search') as HTMLInputElement;
        let enterDispatched = false;
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                enterDispatched = true;
            }
        });

        const result = await __agent_typeByPlaceholder('Search', 'query');
        expect(result.typed).toBe(true);
        expect(input.value).toBe('query');
        expect(enterDispatched).toBe(true);
    });

    it('l) returns {typed:false} when placeholder missing', async () => {
        makePage(`<form><input placeholder="Other"/></form>`);
        const result = await __agent_typeByPlaceholder('Missing', 'x');
        expect(result.typed).toBe(false);
    });
});

describe('__agent_waitFor', () => {
    beforeEach(() => {
        _resetAgentHelpersState();
        makePage('');
    });

    afterEach(() => {
        _resetAgentHelpersState();
    });

    it('m) returns {found:false} after timeout when text never appears', async () => {
        makePage(`<div><span>static</span></div>`);
        const start = Date.now();
        const result = await __agent_waitFor('WillNeverAppear', 150);
        const elapsed = Date.now() - start;
        expect(result.found).toBe(false);
        expect(elapsed).toBeGreaterThanOrEqual(150);
        expect(elapsed).toBeLessThan(300);
    });

    it('n) returns {found:true} when text is already present', async () => {
        makePage(`<div><button>AlreadyHere</button></div>`);
        const result = await __agent_waitFor('AlreadyHere', 1000);
        expect(result.found).toBe(true);
        expect(result.idx).toBe(1);
    });
});

describe('__agent_wait', () => {
    it('o) resolves after approximately the requested delay', async () => {
        const start = Date.now();
        await __agent_wait(80);
        const elapsed = Date.now() - start;
        expect(elapsed).toBeGreaterThanOrEqual(80);
        expect(elapsed).toBeLessThan(300);
    });

    it('p) handles non-positive values without throwing', async () => {
        await expect(__agent_wait(-1)).resolves.toBeUndefined();
        await expect(__agent_wait(0)).resolves.toBeUndefined();
        await expect(__agent_wait(Number.NaN)).resolves.toBeUndefined();
    });
});
