/**
 * Wait-операции агента.
 */
import {__agent_findByText} from '@/helpers/agentHelpers/queries';
import {waitMs} from '@/helpers/agentHelpers/timing';

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

/** Async sleep в мс (безопасный для неположительных значений). */
export function __agent_wait(ms: number): Promise<void> {
    const safe = typeof ms === 'number' && ms >= 0 ? ms : 0;
    return waitMs(safe);
}
