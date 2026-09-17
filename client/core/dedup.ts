/**
 * Дедупликация подряд идущих одинаковых логов.
 *
 * Сравнивает новый `payload` с последним отправленным по `msg/level/type/stack`.
 * Сетевые логи (`type === 'network'`) дедупликацию обходят.
 */
import type {LogPayload} from '@/types';
import {doFlush, emit} from './flushQueue';

let lastPayload: LogPayload | null = null;
let duplicateCount = 0;

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