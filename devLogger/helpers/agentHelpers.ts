/**
 * Client-side agent helpers — глобальные `__agent_*` функции, доступные
 * через eval (`/__dev_exec`) и через `__agent_snapshot` напрямую.
 *
 * Helpers (см. REFACTORING_PLAN.md §2.2):
 * - __agent_snapshot(selector?)              → string[]
 * - __agent_findByText(text, nth?)           → {idx, tag, text}[]
 * - __agent_clickByText(text, nth?)          → {clicked, idx?}
 * - __agent_click(idx)                       → {clicked, idx?}
 * - __agent_setValueByPlaceholder(ph, value, nth?) → {set, idx?}
 * - __agent_typeByPlaceholder(ph, value)     → {typed}
 * - __agent_waitFor(text, timeoutMs?)        → {found}
 * - __agent_wait(ms)                         → Promise<void>
 *
 * Совместимость с v-model / React:
 * - setValue использует нативный setter `HTMLInputElement.prototype.value` через
 *   `Object.getOwnPropertyDescriptor`, чтобы триггерить observers.
 * - Все события диспатчатся как bubbling (для делегирования в React/Vue).
 * - После изменения ждём один requestAnimationFrame, чтобы scheduler отработал.
 */
import {buildCompactSnapshot, isInteractive} from '@/channels/domChannel';
import type {DomSpec} from '@/types';

type Globalish = Record<string, unknown>;

const g = (): Globalish => globalThis;

interface SnapshotCacheEntry {
    el: Element;
    idx: number;
}

let snapshotCache: SnapshotCacheEntry[] = [];
let snapshotCacheSelector: string | undefined = undefined;

function rebuildSnapshotCache(selector?: string): SnapshotCacheEntry[] {
    const roots =
        typeof selector === 'string' && selector.length > 0 ? Array.from(document.querySelectorAll(selector)) : document.body ? [document.body] : [];

    const interactive: Element[] = [];

    for (const root of roots) {
        if (isInteractive(root)) {
            interactive.push(root);
        }
        for (const child of Array.from(root.querySelectorAll('*'))) {
            if (isInteractive(child)) {
                interactive.push(child);
            }
        }
    }

    snapshotCache = interactive.map((el, i) => ({el, idx: i + 1}));
    snapshotCacheSelector = selector;
    return snapshotCache;
}

function ensureCache(selector?: string): SnapshotCacheEntry[] {
    if (snapshotCache.length === 0 || snapshotCacheSelector !== selector) {
        rebuildSnapshotCache(selector);
    }
    return snapshotCache;
}

function rafFrame(): Promise<void> {
    return new Promise((resolve) => {
        requestAnimationFrame(() => resolve());
    });
}

function waitMs(ms: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

/** Compact DOM снапшот в виде массива строк + обновляет внутренний кеш для __agent_click(idx). */
export function __agent_snapshot(selector?: string): string[] {
    const spec: DomSpec = {format: 'compact'};
    if (typeof selector === 'string') {
        spec.selector = selector;
    }

    const lines = buildCompactSnapshot(spec).split('\n');
    rebuildSnapshotCache(selector);
    return lines;
}

export interface FoundTextMatch {
    idx: number;
    tag: string;
    text: string;
}

/** Рекурсивный поиск интерактивных элементов, чей textContent содержит `text` (case-insensitive). */
export function __agent_findByText(text: string, nth: number = 0): FoundTextMatch[] {
    if (typeof text !== 'string') {
        return [];
    }

    const lower = text.toLowerCase();
    const interactive = ensureCache();

    const matches: FoundTextMatch[] = [];
    for (const entry of interactive) {
        const elText = (entry.el.textContent ?? '').trim();
        if (elText.toLowerCase().includes(lower)) {
            matches.push({idx: entry.idx, tag: entry.el.tagName.toLowerCase(), text: elText});
        }
    }

    void nth;
    return matches;
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
    const entry = snapshotCache.find((e) => e.idx === idx);
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

    const matches = __agent_findByText(text);
    if (matches.length <= nth) {
        return {clicked: false};
    }

    const target = matches[nth];
    return await __agent_click(target.idx);
}

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

export interface WaitForResult {
    found: boolean;
    idx?: number;
}

/** Ждёт появления `text` в DOM (через __agent_findByText). Поллинг каждые 50мс. */
export async function __agent_waitFor(text: string, timeoutMs: number = 5000): Promise<WaitForResult> {
    if (typeof text !== 'string' || text.length === 0) {
        return {found: false};
    }

    const safeTimeout = typeof timeoutMs === 'number' && timeoutMs > 0 ? timeoutMs : 5000;
    const deadline = Date.now() + safeTimeout;

    while (Date.now() < deadline) {
        const matches = __agent_findByText(text);
        if (matches.length > 0) {
            return {found: true, idx: matches[0].idx};
        }
        await waitMs(50);
    }

    return {found: false};
}

/** Async sleep в мс. */
export function __agent_wait(ms: number): Promise<void> {
    const safe = typeof ms === 'number' && ms >= 0 ? ms : 0;
    return waitMs(safe);
}

/**
 * Устанавливает глобальные `__agent_*` функции на `globalThis`.
 * Idempotent: повторный вызов перезаписывает существующие ссылки.
 */
export function installAgentHelpers(): void {
    g().__agent_snapshot = __agent_snapshot;
    g().__agent_findByText = __agent_findByText;
    g().__agent_clickByText = __agent_clickByText;
    g().__agent_click = __agent_click;
    g().__agent_setValueByPlaceholder = __agent_setValueByPlaceholder;
    g().__agent_typeByPlaceholder = __agent_typeByPlaceholder;
    g().__agent_waitFor = __agent_waitFor;
    g().__agent_wait = __agent_wait;
}

/** Сбрасывает кеш снапшота (только для тестов). */
export function _resetAgentHelpersState(): void {
    snapshotCache = [];
    snapshotCacheSelector = undefined;
}
