/**
 * Клиентская регистрация browser-инстанса (вкладки).
 *
 * Генерирует уникальный `instanceId` при первой инициализации,
 * отправляет `dev-instance-register` с метаданными `{url, title}`
 * и периодический `dev-instance-heartbeat`. На `popstate` (смена URL)
 * повторно отправляет register, чтобы сервер обновил метаданные.
 *
 * `instanceId` кешируется на уровне модуля — стабилен в течение жизни
 * одной загрузки страницы, переживает HMR-обновления.
 */
import {
    defaultInstanceHeartbeatMs,
    hmrEventInstanceHeartbeat,
    hmrEventInstanceRegister,
} from '@/constants';

let cachedInstanceId: string | null = null;

/** Генерирует новый instanceId: timestamp + случайный суффикс. */
export function generateInstanceId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Возвращает текущий instanceId, лениво генерируя при первом обращении. */
export function getInstanceId(): string {
    if (cachedInstanceId === null) {
        cachedInstanceId = generateInstanceId();
    }
    return cachedInstanceId;
}

/** Сбрасывает кеш instanceId (только для тестов; production-код не вызывает). */
export function _resetInstanceIdCache(): void {
    cachedInstanceId = null;
}

export interface InstanceRegDeps {
    /** Отправка HMR-события (browser → server). */
    send: (event: string, payload: unknown) => void;
    /** Регистрация HMR-dispose колбэка. */
    onDispose: (cb: () => void) => void;
    /** Подписка на popstate (смена URL через history API). Возвращает unsubscribe. */
    addPopstateListener: (cb: () => void) => () => void;
    /** Текущий URL (window.location.href). */
    getUrl: () => string;
    /** Текущий title (document.title). */
    getTitle: () => string;
    /** Интервал heartbeat в мс. */
    heartbeatMs: number;
    /** Форматирование текущего времени в ISO. */
    now: () => string;
}

export interface InstanceRegHandle {
    instanceId: string;
    /** Немедленный teardown: очистить таймер и popstate. Повторный вызов — noop. */
    dispose: () => void;
}

/**
 * Чистая инициализация instance-регистрации: принимает все side-effects через deps,
 * отправляет начальный register, запускает heartbeat, подписывается на popstate.
 */
export function setupInstanceReg(deps: InstanceRegDeps): InstanceRegHandle {
    const instanceId = getInstanceId();
    let timer: ReturnType<typeof setInterval> | null = null;
    let popstateUnsub: (() => void) | null = null;
    let disposed = false;

    const sendRegister = (): void => {
        deps.send(hmrEventInstanceRegister, {
            id: instanceId,
            url: deps.getUrl(),
            title: deps.getTitle(),
            ts: deps.now(),
        });
    };

    sendRegister();

    timer = setInterval(() => {
        deps.send(hmrEventInstanceHeartbeat, {id: instanceId, ts: deps.now()});
    }, deps.heartbeatMs);

    popstateUnsub = deps.addPopstateListener(() => {
        sendRegister();
    });

    const handle: InstanceRegHandle = {
        instanceId,
        dispose(): void {
            if (disposed) {
                return;
            }
            disposed = true;
            if (timer !== null) {
                clearInterval(timer);
                timer = null;
            }
            if (popstateUnsub !== null) {
                popstateUnsub();
                popstateUnsub = null;
            }
        },
    };

    deps.onDispose(handle.dispose);

    return handle;
}

/** Регистрирует instance + heartbeat для текущей Vite HMR-сессии. Idempotent. */
export function initInstanceReg(): void {
    if (!import.meta.hot) {
        return;
    }

    const handle = setupInstanceReg({
        send: (event, payload) => import.meta.hot?.send(event, payload),
        onDispose: (cb) => import.meta.hot.dispose(cb),
        addPopstateListener: (cb) => {
            const handler = (): void => cb();
            window.addEventListener('popstate', handler);
            return () => window.removeEventListener('popstate', handler);
        },
        getUrl: () => window.location.href,
        getTitle: () => document.title,
        heartbeatMs: defaultInstanceHeartbeatMs,
        now: () => new Date().toISOString(),
    });

    // handle.dispose уже зарегистрирован через deps.onDispose, дополнительных шагов не требуется.
    void handle;
}
