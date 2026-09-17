/**
 * DOM snapshot client channel.
 *
 * Сборка compact/raw снапшотов DOM в браузере и обработка входящих WS-запросов
 * `dev-dom-request` от Vite dev-сервера.
 *
 * Compact: однострочные представления интерактивных элементов
 * с индексами (`tag#idx[...attr] text`).
 *
 * Raw: рекурсивный обход с фильтрами `attrs`/`styles`/`viewportOnly`/`depth`.
 *
 * Чистая сборка (`buildCompactSnapshot`, `buildRawSnapshot`) тестируется в jsdom;
 * HMR-обвязка (`initDomChannel`) вызывается только при наличии `import.meta.hot`.
 */
import {getInstanceId} from '@/channels/instanceReg';
import {hmrEventDomRequest, hmrEventDomResponse} from '@/constants';
import type {DevExecSender} from '@/execChannel';
import type {DomSpec} from '@/types';

export type DevDomSender = DevExecSender;

/** Интерактивный элемент: form-control, link, [tabindex], или имеет id. */
export function isInteractive(el: Element): boolean {
    const tag = el.tagName.toLowerCase();

    if (tag === 'button' || tag === 'input' || tag === 'select' || tag === 'textarea' || tag === 'a') {
        return true;
    }

    if (el.hasAttribute('tabindex')) {
        return true;
    }

    if (el.id && el.id.length > 0) {
        return true;
    }

    return false;
}

function formatAttr(key: string, value: string): string {
    return /[\s"\\]/.test(value) ? `[${key}="${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]` : `[${key}=${value}]`;
}

function getRoots(spec: DomSpec): Element[] {
    if (typeof spec.selector === 'string' && spec.selector.length > 0) {
        return Array.from(document.querySelectorAll(spec.selector));
    }

    if (document.body) {
        return [document.body];
    }

    return [];
}

function describeCompact(el: Element, idx: number): string {
    const tag = el.tagName.toLowerCase();
    const parts: string[] = [`${tag}#${idx}`];

    if (tag === 'input') {
        const inputEl = el as HTMLInputElement;
        const type = el.getAttribute('type');
        const value = el.getAttribute('value');
        const placeholder = el.getAttribute('placeholder');

        if (type) {
            parts.push(`[type=${type}]`);
        }
        if (value !== null) {
            parts.push(formatAttr('val', value));
        }
        if (placeholder !== null) {
            parts.push(formatAttr('ph', placeholder));
        }
        if (inputEl.checked) {
            parts.push('[check]');
        }
    }

    if (tag === 'a') {
        const href = el.getAttribute('href');
        if (href !== null) {
            parts.push(formatAttr('href', href));
        }
    }

    if (el.hasAttribute('disabled')) {
        parts.push('[disabled]');
    }

    const text = (el.textContent ?? '').trim().slice(0, 200);
    return parts.join('') + (text.length > 0 ? ' ' + text : '');
}

function collectInteractive(roots: Element[]): Element[] {
    const result: Element[] = [];

    for (const root of roots) {
        if (isInteractive(root)) {
            result.push(root);
        }
        for (const el of Array.from(root.querySelectorAll('*'))) {
            if (isInteractive(el)) {
                result.push(el);
            }
        }
    }

    return result;
}

/**
 * Compact DOM snapshot — строковое представление интерактивных элементов.
 *
 * Формат строки: `tag#idx[attr1][attr2=val] text`.
 *
 * Focus-режим (`spec.focus`): показывает ±`spec.context` строк вокруг таргета,
 * остальное сворачивает в маркер `·`. Если `focus` не найден — выводит всё без fold.
 */
export function buildCompactSnapshot(spec: DomSpec): string {
    const roots = getRoots(spec);

    if (roots.length === 0) {
        return '<no matches>';
    }

    const interactive = collectInteractive(roots);

    if (interactive.length === 0) {
        return '<no interactive elements>';
    }

    const lines = interactive.map((el, i) => ({idx: i + 1, text: describeCompact(el, i + 1)}));

    if (typeof spec.focus === 'number' && Number.isFinite(spec.focus)) {
        const focusIdx = spec.focus;
        const context = typeof spec.context === 'number' && spec.context >= 0 ? spec.context : 4;
        const focusedAt = lines.findIndex((l) => l.idx === focusIdx);

        if (focusedAt === -1) {
            return lines.map((l) => l.text).join('\n');
        }

        const start = Math.max(0, focusedAt - context);
        const end = Math.min(lines.length - 1, focusedAt + context);
        const out: string[] = [];

        if (start > 0) {
            out.push('·');
        }
        for (let i = start; i <= end; i++) {
            const prefix = i === focusedAt ? '→ ' : '  ';
            out.push(prefix + lines[i].text);
        }
        if (end < lines.length - 1) {
            out.push('·');
        }
        return out.join('\n');
    }

    return lines.map((l) => l.text).join('\n');
}

/** Узел raw-снапшота (rec-структура). */
export interface RawNode {
    tag: string;
    id?: string;
    className?: string;
    attrs?: Record<string, string>;
    inlineStyle?: Record<string, string>;
    computed?: Record<string, string>;
    text?: string;
    children: RawNode[];
}

export interface RawSnapshotResult {
    selector?: string;
    matches: number;
    tree: RawNode[];
    truncated: boolean;
}

const COMPUTED_PROPS = [
    'transform',
    'opacity',
    'animation-name',
    'animation-duration',
    'animation-play-state',
    'transition-duration',
] as const;

function inViewport(rect: DOMRect): boolean {
    const w = typeof window !== 'undefined' ? window.innerWidth : 0;
    const h = typeof window !== 'undefined' ? window.innerHeight : 0;

    if (w === 0 && h === 0) {
        return true;
    }

    return rect.right >= 0 && rect.left <= w && rect.bottom >= 0 && rect.top <= h;
}

function attrsFor(el: Element, mode: 'all' | 'interactive' | 'none'): Record<string, string> | undefined {
    if (mode === 'none') {
        return undefined;
    }
    if (mode === 'interactive' && !isInteractive(el)) {
        return undefined;
    }

    const out: Record<string, string> = {};
    for (const attr of Array.from(el.attributes)) {
        out[attr.name] = attr.value;
    }

    return Object.keys(out).length > 0 ? out : undefined;
}

function inlineStyleFor(el: Element): Record<string, string> | undefined {
    if (!(el instanceof HTMLElement)) {
        return undefined;
    }
    const style = el.style;
    const cssText = style?.cssText ?? '';

    if (cssText.length === 0) {
        return undefined;
    }

    const out: Record<string, string> = {};
    if (typeof style.length === 'number' && style.length > 0) {
        for (let i = 0; i < style.length; i++) {
            const prop = style.item(i);
            if (typeof prop === 'string' && prop.length > 0) {
                const val = style.getPropertyValue(prop);
                if (val) {
                    out[prop] = val;
                }
            }
        }
    } else {
        // Fallback: parse cssText.
        for (const decl of cssText.split(';')) {
            const colon = decl.indexOf(':');
            if (colon === -1) {
                continue;
            }
            const k = decl.slice(0, colon).trim();
            const v = decl.slice(colon + 1).trim();
            if (k && v) {
                out[k] = v;
            }
        }
    }

    return Object.keys(out).length > 0 ? out : undefined;
}

function computedFor(el: Element): Record<string, string> | undefined {
    const cs = window.getComputedStyle(el);
    const out: Record<string, string> = {};

    for (const prop of COMPUTED_PROPS) {
        const v = cs.getPropertyValue(prop);
        if (v) {
            out[prop] = v;
        }
    }

    return Object.keys(out).length > 0 ? out : undefined;
}

function walkNode(
    el: Element,
    depth: number,
    attrsMode: 'all' | 'interactive' | 'none',
    stylesMode: 'none' | 'inline' | 'computed',
    viewportOnly: boolean,
): RawNode {
    const tag = el.tagName.toLowerCase();
    const node: RawNode = {tag, children: []};

    if (el.id) {
        node.id = el.id;
    }
    if (el.className && typeof el.className === 'string') {
        const cls = el.className.trim();
        if (cls.length > 0) {
            node.className = cls;
        }
    }

    const attrs = attrsFor(el, attrsMode);
    if (attrs) {
        node.attrs = attrs;
    }

    if (stylesMode === 'inline') {
        const s = inlineStyleFor(el);
        if (s) {
            node.inlineStyle = s;
        }
    } else if (stylesMode === 'computed') {
        const c = computedFor(el);
        if (c) {
            node.computed = c;
        }
    }

    if (depth > 1) {
        for (const child of Array.from(el.children)) {
            if (viewportOnly) {
                const rect = child.getBoundingClientRect();
                if (!inViewport(rect)) {
                    continue;
                }
            }
            node.children.push(walkNode(child, depth - 1, attrsMode, stylesMode, viewportOnly));
        }
    }

    return node;
}

/**
 * Raw DOM snapshot — JSON-дерево с настраиваемыми attrs/styles/viewportOnly/depth.
 * Если итоговый JSON превышает `maxSize` — повторная попытка с уменьшенной глубиной.
 *
 * `maxSize` берётся из `spec.maxSize` если задано, иначе используется переданный
 * параметр, иначе дефолт 500_000.
 */
export function buildRawSnapshot(spec: DomSpec, maxSize: number = 500_000): RawSnapshotResult {
    const roots = getRoots(spec);
    const depth = typeof spec.depth === 'number' && spec.depth > 0 ? Math.floor(spec.depth) : 5;
    const attrsMode: 'all' | 'interactive' | 'none' = spec.attrs ?? 'interactive';
    const stylesMode: 'none' | 'inline' | 'computed' = spec.styles ?? 'none';
    const viewportOnly = spec.viewportOnly === true;
    const effectiveMaxSize = typeof spec.maxSize === 'number' && spec.maxSize > 0 ? spec.maxSize : maxSize;

    const tree = roots.map((root) => walkNode(root, depth, attrsMode, stylesMode, viewportOnly));

    const result: RawSnapshotResult = {
        matches: roots.length,
        tree,
        truncated: false,
    };
    if (typeof spec.selector === 'string') {
        result.selector = spec.selector;
    }

    const json = JSON.stringify(result);
    if (json.length <= effectiveMaxSize) {
        return result;
    }

    const reducedDepth = Math.max(1, depth - 2);
    const reducedTree = roots.map((root) => walkNode(root, reducedDepth, attrsMode, stylesMode, viewportOnly));

    return {
        selector: result.selector,
        matches: roots.length,
        tree: reducedTree,
        truncated: true,
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

/**
 * Создаёт handler входящих `dev-dom-request` envelope'ов.
 * Принимает `data` вида `{id, spec, instanceId?}`, шлёт `dev-dom-response`.
 *
 * Если `instanceId` в payload'е не совпадает с локальным — обработка тихо игнорируется
 * (фильтрация на стороне initDomChannel; здесь это просто защита).
 */
export function makeDomHandler(send: DevDomSender): (data: unknown) => Promise<void> {
    return (data: unknown): Promise<void> => {
        return new Promise<void>((resolve) => {
            if (!isRecord(data) || typeof data.id !== 'string') {
                resolve();
                return;
            }

            const id = data.id;
            const spec: DomSpec = isRecord(data.spec)
                ? (data.spec as unknown as DomSpec)
                : {format: 'compact'};

        try {
            if (spec.format === 'raw') {
                const snapshot = buildRawSnapshot(spec, typeof spec.maxSize === 'number' ? spec.maxSize : 500_000);
                const sizeBytes = JSON.stringify(snapshot.tree).length;
                send(hmrEventDomResponse, {
                    id,
                    fromInstance: getInstanceId(),
                    ok: true,
                    tree: snapshot.tree,
                    sizeBytes,
                    truncated: snapshot.truncated,
                });
            } else {
                const value = buildCompactSnapshot(spec);
                send(hmrEventDomResponse, {
                    id,
                    fromInstance: getInstanceId(),
                    ok: true,
                    value,
                });
            }
        } catch (e) {
                send(hmrEventDomResponse, {
                    id,
                    fromInstance: getInstanceId(),
                    ok: false,
                    error: e instanceof Error ? e.message : String(e),
                });
            }
            resolve();
        });
    };
}

/** Регистрирует HMR-слушатель `dev-dom-request` (idempotent через dispose). */
export function initDomChannel(): void {
    if (!import.meta.hot) {
        return;
    }

    const send: DevDomSender = (event, payload) => import.meta.hot?.send(event, payload);
    const handler = makeDomHandler(send);

    const filtered = async (data: unknown): Promise<void> => {
        if (isRecord(data) && typeof data.instanceId === 'string' && data.instanceId !== getInstanceId()) {
            return;
        }
        await handler(data);
    };

    import.meta.hot.on(hmrEventDomRequest, filtered);

    import.meta.hot.dispose(() => {
        if (typeof import.meta.hot.off === 'function') {
            import.meta.hot.off(hmrEventDomRequest, filtered);
        }
    });
}
