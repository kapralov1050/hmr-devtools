/**
 * Client-side agent helpers — глобальные `__agent_*` функции, доступные
 * через eval (`/__dev_exec`) и через `__agent_snapshot` напрямую.
 *
 * Helpers (см. REFACTORING_PLAN.md §2.2):
 * - __agent_snapshot(selector?)              → string[]
 * - __agent_findByText(text)                → {idx, tag, text}[]
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
import {_resetAgentHelpersState} from '@/helpers/agentHelpers/cache';
import {
    __agent_click,
    __agent_clickByText,
    __agent_setValueByPlaceholder,
    __agent_typeByPlaceholder,
    type ClickResult,
    type SetValueResult,
    type TypedResult,
} from '@/helpers/agentHelpers/interactions';
import {__agent_findByText, __agent_snapshot, type FoundTextMatch} from '@/helpers/agentHelpers/queries';
import {__agent_wait, __agent_waitFor, type WaitForResult} from '@/helpers/agentHelpers/waits';

type Globalish = Record<string, unknown>;

const g = (): Globalish => globalThis;

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

export {_resetAgentHelpersState};
export {
    __agent_click,
    __agent_clickByText,
    __agent_findByText,
    __agent_setValueByPlaceholder,
    __agent_snapshot,
    __agent_typeByPlaceholder,
    __agent_wait,
    __agent_waitFor,
};
export type {ClickResult, FoundTextMatch, SetValueResult, TypedResult, WaitForResult};
