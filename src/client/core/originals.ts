/**
 * Оригиналы перехватываемых методов (window.console, window.fetch, XHR) и
 * реестр window-слушателей, установленных dev-логгером.
 *
 * Используются HMR-dispose для восстановления оригинальных методов и снятия
 * слушателей при обновлении модуля.
 */
/* eslint-disable no-console */
export const originalConsoleLog = console.log;
export const originalConsoleInfo = console.info;
export const originalConsoleWarn = console.warn;
export const originalConsoleError = console.error;
export const originalFetch = window.fetch;
export const originalXhrOpen = XMLHttpRequest.prototype.open;
export const originalXhrSend = XMLHttpRequest.prototype.send;

export interface TrackedListener {
    type: string;
    fn: (e: Event) => void;
    capture: boolean;
}

export const trackedListeners: TrackedListener[] = [];