import type {Plugin} from 'vite';
import {pilot as pilotImpl, type PilotOptions} from './server';

export type {PilotOptions};

/**
 * Vite-плагин, дающий AI-агенту «глаза и руки» в dev-браузере через HMR WebSocket.
 *
 * Подключается в `vite.config.ts`:
 * ```ts
 * import pilot from 'vite-agent-bridge';
 * export default {plugins: [pilot()]};
 * ```
 */
export default function pilot(options?: PilotOptions): Plugin {
    return pilotImpl(options);
}

export {pilot};

// Re-export public types
export type {
    InstanceId,
    InstanceState,
    Manifest,
    ManifestTool,
    LogPayload,
    DomSpec,
    DomResponse,
    AgentEnvelope,
} from './client/types';

// Re-export client-side initialiser
export {initDevLogger} from './client';
