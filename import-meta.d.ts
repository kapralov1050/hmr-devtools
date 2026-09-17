/**
 * Ambient declarations for devLogger's client-side modules.
 * Vite's `vite/client` ambient types are intentionally NOT included — we declare
 * only what's needed (ImportMeta.hot / ImportMeta.env) to avoid the `hot?`
 * modifier conflict in TS2687.
 */
import type {ViteHotContext} from 'vite/types/hot';

declare global {
    interface ImportMeta {
        readonly hot: ViteHotContext;
        readonly env: Record<string, unknown>;
    }
}

export {};