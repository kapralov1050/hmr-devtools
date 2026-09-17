/* eslint-disable no-console */
/**
 * Dev-only браузерный перехватчик логов.
 *
 * Перехватывает console.log/info/warn/error, window.onerror, unhandledrejection,
 * Vue errorHandler/warnHandler, ошибки загрузки ресурсов и сетевые запросы (fetch/XHR),
 * отправляя их на Vite dev-сервер по HMR WebSocket для in-memory буфера.
 *
 * Активен только в dev-режиме (наличие import.meta.hot).
 * В production-бандл код не попадает (динамический импорт под import.meta.env.DEV).
 *
 * WebSocket и SSE (EventSource) НЕ перехватываются.
 */
import {initInstanceReg} from '@/channels/instanceReg';
import {initConsoleInterceptors} from '@/consoleInterceptor';
import {
    flushDuplicates,
    originalConsoleError,
    originalConsoleInfo,
    originalConsoleLog,
    originalConsoleWarn,
    originalFetch,
    originalXhrOpen,
    originalXhrSend,
    resetDedupState,
    trackedListeners,
} from '@/core';
import {initDevExec} from '@/execChannel';
import {initGlobalErrorInterceptors} from '@/globalErrorInterceptor';
import {initNetworkInterceptors} from '@/networkInterceptor';
import {setupDevLogger} from '@/vueInterceptor';

export {setupDevLogger};

let installed = false;

/**
 * Устанавливает перехватчики console, глобальных ошибок и сети.
 * Идемпотентна: повторный вызов игнорируется. HMR-dispose восстанавливает оригиналы.
 * Вызывается из main.ts ДО app.mount.
 *
 * `initInstanceReg()` вызывается первым, чтобы `getInstanceId()` возвращал
 * стабильный id во всех последующих envelope'ах (`dev-log`, `dev-exec-result`).
 */
export function initDevLogger(): void {
    if (!import.meta.hot || installed) {
        return;
    }

    installed = true;

    initInstanceReg();
    initConsoleInterceptors();
    initGlobalErrorInterceptors();
    initNetworkInterceptors();
    initDevExec();

    import.meta.hot.dispose(() => {
        console.log = originalConsoleLog;
        console.info = originalConsoleInfo;
        console.warn = originalConsoleWarn;
        console.error = originalConsoleError;
        window.fetch = originalFetch;
        XMLHttpRequest.prototype.open = originalXhrOpen;
        XMLHttpRequest.prototype.send = originalXhrSend;

        for (const l of trackedListeners) {
            window.removeEventListener(l.type, l.fn, l.capture);
        }

        trackedListeners.length = 0;
        flushDuplicates();
        resetDedupState();
        installed = false;
    });
}
