/**
 * Rate limiting: буферизация логов с отправкой через HMR WebSocket.
 *
 * Использует `queueMicrotask` для батчинга и защиты от повторного планирования.
 * При превышении `maxBatch` отправляет первую порцию + маркер о троттлинге.
 */
import {getInstanceId} from '@/channels/instanceReg';
import {hmrEventLog} from '@/constants';
import type {LogPayload} from '@/types';

export const maxBatch = 100;

let pending: LogPayload[] = [];
let flushScheduled = false;

/** Отправляет накопленный батч логов через HMR WebSocket, при превышении maxBatch — троттлит с маркером. */
function doFlush(): void {
    flushScheduled = false;
    const batch = pending;

    pending = [];

    if (!import.meta.hot || batch.length === 0) {
        return;
    }

    const send = (p: LogPayload): void => {
        if (import.meta.hot) {
            import.meta.hot.send(hmrEventLog, {id: getInstanceId(), payload: p});
        }
    };

    if (batch.length <= maxBatch) {
        for (const p of batch) {
            send(p);
        }

        return;
    }

    for (let i = 0; i < maxBatch; i++) {
        const p = batch[i];

        if (p) {
            send(p);
        }
    }

    const last = batch[maxBatch - 1];

    if (last) {
        send({...last, ts: new Date().toISOString(), msg: `[${batch.length - maxBatch} messages throttled]`});
    }
}

/** Планирует однократный flush через queueMicrotask (защита от повторного планирования). */
function scheduleFlush(): void {
    if (flushScheduled) {
        return;
    }

    flushScheduled = true;
    queueMicrotask(doFlush);
}

/** Помещает лог в pending-буфер и планирует flush. */
function emit(payload: LogPayload): void {
    pending.push(payload);
    scheduleFlush();
}

export {doFlush, emit, scheduleFlush};