import {getInstanceId} from '@/channels/instanceReg';
import {buildCompactSnapshot} from '@/channels/domChannel/compact';
import {isInteractive} from '@/channels/domChannel/interactive';
import {buildRawSnapshot} from '@/channels/domChannel/raw';
import type {DevDomSender, RawNode, RawSnapshotResult} from '@/channels/domChannel/types';
import {hmrEventDomRequest, hmrEventDomResponse} from '@/constants';
import type {DomSpec} from '@/types';

interface HotApi {
    readonly data: unknown;
    send<T extends string>(event: T, data?: unknown): void;
    on<T extends string>(event: T, cb: (payload: unknown) => void): void;
    off<T extends string>(event: T, cb: (payload: unknown) => void): void;
    dispose(cb: (data: unknown) => void): void;
}
interface MetaWithHot {
    hot?: HotApi | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

/**
 * Создаёт handler входящих `dev-dom-request` envelope'ов.
 * Принимает `data` вида `{id, spec, instanceId?}`, шлёт `dev-dom-response`.
 *
 * Если `instanceId` в payload'е не совпадает с локальным — обработка тихо игнорируется
 * (фильтрация на стороне initDomChannel; здесь это просто защита).
 */
export function makeDomHandler(send: DevDomSender): (data: unknown) => Promise<void> {
    return (data: unknown): Promise<void> => {
        return new Promise<void>((resolve) => {
            if (!isRecord(data) || typeof data.id !== 'string') {
                resolve();
                return;
            }

            const id: string = data.id;
            const spec: DomSpec = isRecord(data.spec) ? (data.spec as unknown as DomSpec) : {format: 'compact'};

            try {
                if (spec.format === 'raw') {
                    const snapshot: RawSnapshotResult = buildRawSnapshot(
                        spec,
                        typeof spec.maxSize === 'number' ? spec.maxSize : 500_000,
                    );
                    const sizeBytes = JSON.stringify(snapshot.tree).length;
                    send(hmrEventDomResponse, {
                        id,
                        fromInstance: getInstanceId(),
                        ok: true,
                        tree: snapshot.tree,
                        sizeBytes,
                        truncated: snapshot.truncated,
                    });
                } else {
                    const value: string = buildCompactSnapshot(spec);
                    send(hmrEventDomResponse, {
                        id,
                        fromInstance: getInstanceId(),
                        ok: true,
                        value,
                    });
                }
            } catch (e) {
                send(hmrEventDomResponse, {
                    id,
                    fromInstance: getInstanceId(),
                    ok: false,
                    error: e instanceof Error ? e.message : String(e),
                });
            }
            resolve();
        });
    };
}

/** Регистрирует HMR-слушатель `dev-dom-request` (idempotent через dispose). */
export function initDomChannel(): void {
    const meta = import.meta as unknown as MetaWithHot;
    const hot = meta.hot;
    if (!hot) {
        return;
    }

    const send: DevDomSender = (event, payload) => {
        hot.send(event, payload);
    };
    const handler = makeDomHandler(send);

    const filtered = (data: unknown): void => {
        if (isRecord(data) && typeof data.instanceId === 'string' && data.instanceId !== getInstanceId()) {
            return;
        }
        void handler(data);
    };

    hot.on(hmrEventDomRequest, filtered);

    hot.dispose(() => {
        if (typeof hot.off === 'function') {
            hot.off(hmrEventDomRequest, filtered);
        }
    });
}

export {buildCompactSnapshot, buildRawSnapshot, isInteractive};
export type {DevDomSender, RawNode, RawSnapshotResult};
