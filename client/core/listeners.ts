/**
 * Регистрация window-listener'ов с трекингом для последующего снятия при HMR dispose.
 */
import {trackedListeners} from './originals';

/** Регистрирует window-listener с трекингом для последующего снятия при HMR dispose. */
export function addTrackedListener(type: string, fn: (e: Event) => void, capture: boolean): void {
    window.addEventListener(type, fn, capture);
    trackedListeners.push({type, fn, capture});
}