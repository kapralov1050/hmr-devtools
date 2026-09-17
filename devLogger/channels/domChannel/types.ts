/**
 * Public types for the DOM snapshot channel.
 *
 * Re-exported from `./index` to keep the boundary stable: callers continue
 * to import these from `@/channels/domChannel`.
 */
import type {DevExecSender} from '@/execChannel';

export type DevDomSender = DevExecSender;

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

/**
 * Свойства computed-style, которые попадают в raw-снапшот при `styles: 'computed'`.
 */
export const COMPUTED_PROPS: readonly string[] = [
    'transform',
    'opacity',
    'animation-name',
    'animation-duration',
    'animation-play-state',
    'transition-duration',
];
