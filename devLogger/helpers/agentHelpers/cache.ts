/**
 * Cache состояния для agent-helpers.
 *
 * Хранит массив `{el, idx}` интерактивных элементов, обнаруженных при последнем
 * `__agent_snapshot()`, чтобы `__agent_click(idx)` мог адресовать элемент по индексу
 * без повторного обхода DOM.
 */
import {isInteractive} from '@/channels/domChannel';

interface SnapshotCacheEntry {
    el: Element;
    idx: number;
}

let snapshotCache: SnapshotCacheEntry[] = [];
let snapshotCacheSelector: string | undefined = undefined;

export function rebuildSnapshotCache(selector?: string): SnapshotCacheEntry[] {
    const roots =
        typeof selector === 'string' && selector.length > 0
            ? Array.from(document.querySelectorAll(selector))
            : document.body
              ? [document.body]
              : [];

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

export function ensureCache(selector?: string): SnapshotCacheEntry[] {
    if (snapshotCache.length === 0 || snapshotCacheSelector !== selector) {
        rebuildSnapshotCache(selector);
    }
    return snapshotCache;
}

/** Сбрасывает кеш снапшота (только для тестов). */
export function _resetAgentHelpersState(): void {
    snapshotCache = [];
    snapshotCacheSelector = undefined;
}
