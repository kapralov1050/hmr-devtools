/**
 * Pure raw-DOM builders (без HMR-зависимостей).
 *
 * Тестируются в jsdom. HMR-обвязка живёт в `./index`.
 */
import {isInteractive} from '@/channels/domChannel/interactive';
import {COMPUTED_PROPS, type RawNode, type RawSnapshotResult} from '@/channels/domChannel/types';
import type {DomSpec} from '@/types';

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

function getRoots(spec: DomSpec): Element[] {
    if (typeof spec.selector === 'string' && spec.selector.length > 0) {
        return Array.from(document.querySelectorAll(spec.selector));
    }

    if (document.body) {
        return [document.body];
    }

    return [];
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
