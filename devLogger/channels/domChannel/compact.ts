/**
 * Pure compact-DOM builders (без HMR-зависимостей).
 *
 * Тестируются в jsdom. HMR-обвязка живёт в `./index`.
 */
import {isInteractive} from '@/channels/domChannel/interactive';
import type {DomSpec} from '@/types';

export {isInteractive};

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
