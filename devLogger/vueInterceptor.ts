/**
 * Vue errorHandler/warnHandler с chaining предыдущих хендлеров (совместимость с Sentry).
 * Восстановление оригинальных хендлеров при HMR dispose.
 */
import type {App} from 'vue';
import {originalConsoleError, originalConsoleWarn, sendLog} from '@/core';
import {createLog, getComponentName, getStack} from '@/helpers';

/**
 * Регистрирует Vue-обработчики ошибок и предупреждений на инстансе приложения,
 * chain'ит предыдущие хендлеры (совместимость с Sentry). Вызывается в main.ts ДО mount.
 */
export function setupDevLogger(app: App): void {
    if (!import.meta.hot) {
        return;
    }

    const prevErrorHandler = app.config.errorHandler;

    app.config.errorHandler = (err, instance, info) => {
        const message = err instanceof Error ? err.message : String(err);
        const name = getComponentName(instance);
        const msg = name ? `${message} [${name}]${info ? ` (${info})` : ''}` : info ? `${message} (${info})` : message;

        sendLog(createLog({level: 'error', type: 'vue:error', msg, stack: getStack(err)}));
        // Вывод в консоль без повторной отправки (оригинальный console.error)
        originalConsoleError('[Vue error]:', err, info ? `(${info})` : '');
        prevErrorHandler?.(err, instance, info);
    };

    const prevWarnHandler = app.config.warnHandler;

    app.config.warnHandler = (msg, instance, trace) => {
        const name = getComponentName(instance);
        const text = name ? `${String(msg)} [${name}]` : String(msg);
        const traceStr = typeof trace === 'string' ? trace : undefined;

        sendLog(createLog({level: 'warn', type: 'vue:warn', msg: text, stack: traceStr}));
        // Vue 3.5 при установленном warnHandler не вызывает console.warn — выводим вручную
        originalConsoleWarn(`[Vue warn]: ${String(msg)}`, traceStr ?? '');
        prevWarnHandler?.(msg, instance, trace);
    };

    // Восстановление Vue-хендлеров при HMR dispose
    import.meta.hot.dispose(() => {
        app.config.errorHandler = prevErrorHandler;
        app.config.warnHandler = prevWarnHandler;
    });
}
