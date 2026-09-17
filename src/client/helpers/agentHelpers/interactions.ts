/**
 * Interactions агента: click / setValue / type.
 *
 * Все мутации идут через нативные setter'ы + bubbling events, чтобы триггерить
 * v-model (Vue) и синтетические onChange (React).
 */
import {ensureCache} from '@/helpers/agentHelpers/cache';
import {__agent_findByText, type FoundTextMatch} from '@/helpers/agentHelpers/queries';
import {rafFrame} from '@/helpers/agentHelpers/timing';

function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
    const proto =
        el instanceof HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');

    if (desc && typeof desc.set === 'function') {
        desc.set.call(el, value);
    } else {
        el.value = value;
    }
}

function findByPlaceholder(ph: string): (HTMLInputElement | HTMLTextAreaElement)[] {
    const nodeList = document.querySelectorAll('input,textarea');
    const out: (HTMLInputElement | HTMLTextAreaElement)[] = [];
    for (const el of Array.from(nodeList)) {
        if ((el.getAttribute('placeholder') ?? '') === ph) {
            out.push(el as HTMLInputElement | HTMLTextAreaElement);
        }
    }
    return out;
}

export interface ClickResult {
    clicked: boolean;
    idx?: number;
}

/** Клик по индексу из последнего `__agent_snapshot()`. */
export async function __agent_click(idx: number): Promise<ClickResult> {
    if (typeof idx !== 'number' || !Number.isFinite(idx)) {
        return {clicked: false};
    }

    ensureCache();
    const entry = ensureCache().find((e) => e.idx === idx);
    if (!entry) {
        return {clicked: false};
    }

    try {
        (entry.el as HTMLElement).click();
    } catch {
        return {clicked: false};
    }

    await rafFrame();
    return {clicked: true, idx};
}

/** Клик по nth-му интерактивному элементу, содержащему `text`. */
export async function __agent_clickByText(text: string, nth: number = 0): Promise<ClickResult> {
    if (typeof text !== 'string' || text.length === 0) {
        return {clicked: false};
    }

    const matches: FoundTextMatch[] = __agent_findByText(text);
    if (matches.length <= nth) {
        return {clicked: false};
    }

    const target = matches[nth];
    return await __agent_click(target.idx);
}

export interface SetValueResult {
    set: boolean;
    idx?: number;
}

/** Устанавливает значение input/textarea через нативный setter + события `input` + `change`. */
export async function __agent_setValueByPlaceholder(ph: string, value: string, nth: number = 0): Promise<SetValueResult> {
    if (typeof ph !== 'string') {
        return {set: false};
    }

    const matches = findByPlaceholder(ph);
    if (matches.length <= nth) {
        return {set: false};
    }

    const el = matches[nth];
    try {
        setNativeValue(el, value);
        el.dispatchEvent(new Event('input', {bubbles: true}));
        el.dispatchEvent(new Event('change', {bubbles: true}));
    } catch {
        return {set: false};
    }

    await rafFrame();
    return {set: true};
}

export interface TypedResult {
    typed: boolean;
}

/** `setValue` + диспатч Enter (keydown) для submit-форм. */
export async function __agent_typeByPlaceholder(ph: string, value: string): Promise<TypedResult> {
    const r = await __agent_setValueByPlaceholder(ph, value);
    if (!r.set) {
        return {typed: false};
    }

    const matches = findByPlaceholder(ph);
    if (matches.length === 0) {
        return {typed: false};
    }

    const el = matches[0];
    try {
        el.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', code: 'Enter', bubbles: true}));
        const form = el.closest('form');
        if (form) {
            form.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}));
        }
    } catch {
        return {typed: false};
    }

    await rafFrame();
    return {typed: true};
}
