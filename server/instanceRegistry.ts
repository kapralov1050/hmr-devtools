/**
 * Multi-instance registry: Map<InstanceId, InstanceEntry>.
 *
 * Управляет жизненным циклом вкладок: создание/обновление через `ensureInstance`,
 * очистка протухших через `pruneStaleInstances`, перечисление через `listInstances`.
 * Приём WS-событий `dev-instance-register` и `dev-instance-heartbeat` —
 * через `handleInstanceRegister` / `handleInstanceHeartbeat`.
 */
import type {InstanceId, InstanceState} from '../client/types';
import type {DevLogsContext, InstanceEntry} from './types';

/**
 * Сколько времени хранить инстанс без heartbeat, прежде чем prune'нуть.
 * Default: 3 heartbeat'а (30 с × 3 = 90 с).
 */
export const defaultPruneMaxAgeMs = 90_000;

interface InstanceMeta {
    url?: string;
    title?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

/**
 * Создаёт инстанс при первом обращении или обновляет `lastSeen`/meta существующего.
 * Возвращает актуальное состояние (для последующего push'а в buffer).
 */
export function ensureInstance(ctx: DevLogsContext, id: InstanceId, meta: InstanceMeta = {}): InstanceEntry {
    const now = new Date().toISOString();
    const existing = ctx.instances.get(id);

    if (!existing) {
        const created: InstanceEntry = {
            id,
            url: meta.url ?? '',
            title: meta.title ?? '',
            lastSeen: now,
            buffer: [],
        };
        ctx.instances.set(id, created);
        return created;
    }

    existing.lastSeen = now;
    if (meta.url !== undefined) {
        existing.url = meta.url;
    }
    if (meta.title !== undefined) {
        existing.title = meta.title;
    }
    return existing;
}

/**
 * Удаляет инстансы, которые не видели дольше `maxAgeMs`.
 * Возвращает список удалённых id (для отладки / логирования).
 */
export function pruneStaleInstances(ctx: DevLogsContext, maxAgeMs: number = defaultPruneMaxAgeMs): InstanceId[] {
    const nowMs = Date.now();
    const removed: InstanceId[] = [];

    for (const [id, entry] of ctx.instances) {
        const lastMs = Date.parse(entry.lastSeen);
        if (Number.isFinite(lastMs) && nowMs - lastMs > maxAgeMs) {
            ctx.instances.delete(id);
            removed.push(id);
        }
    }

    return removed;
}

/** Список всех активных инстансов в виде `InstanceState` (без buffer'а). */
export function listInstances(ctx: DevLogsContext): InstanceState[] {
    return Array.from(ctx.instances.values()).map(({id, url, title, lastSeen}) => ({id, url, title, lastSeen}));
}

/** Принимает `dev-instance-register` от браузера: создаёт/обновляет инстанс с meta. */
export function handleInstanceRegister(data: unknown, ctx: DevLogsContext): void {
    if (!isRecord(data) || typeof data.id !== 'string') {
        return;
    }

    ensureInstance(ctx, data.id, {
        url: typeof data.url === 'string' ? data.url : undefined,
        title: typeof data.title === 'string' ? data.title : undefined,
    });
}

/** Принимает `dev-instance-heartbeat`: обновляет `lastSeen` существующего инстанса. */
export function handleInstanceHeartbeat(data: unknown, ctx: DevLogsContext): void {
    if (!isRecord(data) || typeof data.id !== 'string') {
        return;
    }

    ensureInstance(ctx, data.id);
}
