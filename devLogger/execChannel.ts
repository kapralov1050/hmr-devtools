/**
 * Dev-only двунаправленный канал выполнения JS в браузере.
 * Слушает HMR-событие `dev-exec` от Vite dev-сервера, выполняет код
 * (async-IIFE, доступен `await` и `return`) и отправляет результат
 * событием `dev-exec-result`.
 *
 * Активен только в dev-режиме (наличие import.meta.hot).
 */
function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function serialize(value: unknown): string {
    try {
        return JSON.stringify(value) ?? String(value);
    } catch {
        return String(value);
    }
}

/** Регистрирует HMR-слушатель `dev-exec` (idempotent через dispose). */
export function initDevExec(): void {
    if (!import.meta.hot) {
        return;
    }

    const handler = async (data: unknown): Promise<void> => {
        if (!isRecord(data) || typeof data.id !== 'string' || typeof data.code !== 'string') {
            return;
        }

        const {id, code} = data;

        try {
            const fn = new Function('"use strict"; return (async () => {\n' + code + '\n})();');

            const value = await fn();

            import.meta.hot?.send('dev-exec-result', {id, ok: true, value: serialize(value)});
        } catch (e) {
            import.meta.hot?.send('dev-exec-result', {
                id,
                ok: false,
                error: e instanceof Error ? (e.stack ?? e.message) : String(e),
            });
        }
    };

    import.meta.hot.on('dev-exec', handler);

    import.meta.hot.dispose(() => {
        if (typeof import.meta.hot.off === 'function') {
            import.meta.hot.off('dev-exec', handler);
        }
    });
}
