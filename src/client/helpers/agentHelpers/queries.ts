/**
 * Snapshot- и find-запросы агента.
 *
 * `__agent_snapshot` обновляет внутренний кеш; остальные queries используют его.
 */
import {buildCompactSnapshot} from '@/channels/domChannel';
import {rebuildSnapshotCache, ensureCache} from '@/helpers/agentHelpers/cache';
import type {DomSpec} from '@/types';

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
export function __agent_findByText(text: string): FoundTextMatch[] {
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

    return matches;
}
