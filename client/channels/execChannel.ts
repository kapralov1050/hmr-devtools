/**
 * Dev-only двунаправленный канал выполнения JS в браузере.
 * Слушает HMR-событие `dev-exec` от Vite dev-сервера, выполняет код
 * (async-IIFE, доступен `await` и `return`) и отправляет результат
 * событием `dev-exec-result`.
 *
 * Активен только в dev-режиме (наличие import.meta.hot).
 *
 * Чистая логика вынесена в `makeDevExecHandler(send)` — это позволяет
 * тестировать handler без мока `import.meta.hot` через инъекцию sender'а.
 */
import {getInstanceId} from '@/channels/instanceReg';
import {defaultExecTimeoutMs, hmrEventExec, hmrEventExecResult} from '@/constants';
import {ExecTimeoutError, withTimeout} from '@/core/execTimeout';
import {safeSerialize} from '@/core/serialize';

export type DevExecSender = (event: string, payload: unknown) => void;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

/** Создаёт handler `dev-exec`, отправляющий ответы через переданный sender. */
export function makeDevExecHandler(send: DevExecSender): (data: unknown) => Promise<void> {
    return async (data: unknown): Promise<void> => {
        if (!isRecord(data) || typeof data.id !== 'string' || typeof data.code !== 'string') {
            return;
        }

        const {id, code} = data;

        try {
            const fn = new Function('"use strict"; return (async () => {\n' + code + '\n})();');

            const value = await withTimeout(fn(), defaultExecTimeoutMs);

            const serialized = safeSerialize(value);
            if (serialized.ok) {
                send(hmrEventExecResult, {id, fromInstance: getInstanceId(), ok: true, value: serialized.value});
            } else {
                send(hmrEventExecResult, {
                    id,
                    fromInstance: getInstanceId(),
                    ok: false,
                    error: serialized.error,
                    hint: serialized.hint,
                });
            }
        } catch (e) {
            const errorMessage =
                e instanceof ExecTimeoutError
                    ? e.message
                    : e instanceof Error
                      ? (e.stack ?? e.message)
                      : String(e);
            const hint = e instanceof ExecTimeoutError ? (e.hint ?? 'Reduce work or increase defaultExecTimeoutMs') : undefined;
            send(hmrEventExecResult, {
                id,
                fromInstance: getInstanceId(),
                ok: false,
                error: errorMessage,
                hint,
            });
        }
    };
}

/** Регистрирует HMR-слушатель `dev-exec` (idempotent через dispose). */
export function initDevExec(): void {
    if (!import.meta.hot) {
        return;
    }

    const send: DevExecSender = (event, payload) => import.meta.hot?.send(event, payload);
    const handler = makeDevExecHandler(send);

    // Filter: выполняем только exec-запросы, адресованные нашему инстансу.
    // Если instanceId в WS-сообщении отсутствует (legacy), выполняем (back-compat).
    const filtered = async (data: unknown): Promise<void> => {
        if (isRecord(data) && typeof data.instanceId === 'string' && data.instanceId !== getInstanceId()) {
            return;
        }
        await handler(data);
    };

    import.meta.hot.on(hmrEventExec, filtered);

    import.meta.hot.dispose(() => {
        if (typeof import.meta.hot.off === 'function') {
            import.meta.hot.off(hmrEventExec, filtered);
        }
    });
}
