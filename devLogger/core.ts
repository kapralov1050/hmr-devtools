/* eslint-disable no-console */
/**
 * Ядро dev-логгера: rate limiting, дедупликация, трекинг listener'ов.
 * Только для dev-режима (import.meta.hot).
 */
import {hmrEventLog} from '@/constants';
import type {LogPayload} from '@/types';

const maxBatch = 100;

// Оригиналы перехватываемых методов, сохранённые до обёртки.
export const originalConsoleLog = console.log;
export const originalConsoleInfo = console.info;
export const originalConsoleWarn = console.warn;
export const originalConsoleError = console.error;
export const originalFetch = window.fetch;
export const originalXhrOpen = XMLHttpRequest.prototype.open;
export const originalXhrSend = XMLHttpRequest.prototype.send;

interface TrackedListener {
    type: string;
    fn: (e: Event) => void;
    capture: boolean;
}

export const trackedListeners: TrackedListener[] = [];

let lastPayload: LogPayload | null = null;
let duplicateCount = 0;

/* ----------------------------- Rate limiting ----------------------------- */

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
            import.meta.hot.send(hmrEventLog, p);
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

/* ----------------------------- Дедупликация ----------------------------- */

/** Главная точка отправки: дедупликация по msg/level/type/stack, сетевые логи обходят дедупликацию. */
export function sendLog(payload: LogPayload): void {
    if (payload.type === 'network') {
        emit(payload);

        return;
    }

    const isDuplicate =
        lastPayload !== null &&
        payload.msg === lastPayload.msg &&
        payload.level === lastPayload.level &&
        payload.type === lastPayload.type &&
        payload.stack === lastPayload.stack;

    if (isDuplicate) {
        duplicateCount++;

        return;
    }

    if (duplicateCount > 0 && lastPayload) {
        emit({
            ...lastPayload,
            ts: new Date().toISOString(),
            msg: `[${duplicateCount} duplicate messages omitted] ${lastPayload.msg}`,
        });
        duplicateCount = 0;
    }

    lastPayload = payload;
    emit(payload);
}

/** Отправляет маркер накопленных дубликатов и сбрасывает pending-буфер (вызывается при pagehide и HMR dispose). */
export function flushDuplicates(): void {
    if (duplicateCount > 0 && lastPayload) {
        emit({
            ...lastPayload,
            ts: new Date().toISOString(),
            msg: `[${duplicateCount} duplicate messages omitted] ${lastPayload.msg}`,
        });
        duplicateCount = 0;
    }

    doFlush();
}

/** Обнуляет состояние дедупликации (lastPayload, duplicateCount). */
export function resetDedupState(): void {
    lastPayload = null;
    duplicateCount = 0;
}

/** Регистрирует window-listener с трекингом для последующего снятия при HMR dispose. */
export function addTrackedListener(type: string, fn: (e: Event) => void, capture: boolean): void {
    window.addEventListener(type, fn, capture);
    trackedListeners.push({type, fn, capture});
}
