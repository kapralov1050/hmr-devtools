/**
 * Перехват fetch и XMLHttpRequest.
 * Логируются API-вызовы, cross-origin, ошибки (status >= 400 / abort / timeout / network failure).
 */
import {sendLog} from '@/core/dedup';
import {getStack} from '@/core/errorHelpers';
import {createLog} from '@/core/logPayload';
import {originalFetch, originalXhrOpen, originalXhrSend} from '@/core/originals';
import {endpoint} from '@/constants';

function isViteInternal(url: string): boolean {
    try {
        const u = new URL(url, window.location.origin);
        const path = u.pathname;

        return path.startsWith('/@') || path.startsWith('/node_modules') || path === endpoint;
    } catch {
        return false;
    }
}

function isCrossOrigin(url: string): boolean {
    try {
        return new URL(url, window.location.origin).origin !== window.location.origin;
    } catch {
        return false;
    }
}

function isApiPath(url: string): boolean {
    let path: string;

    try {
        path = new URL(url, window.location.origin).pathname;
    } catch {
        path = url.split('?')[0];
    }

    if (path.includes('/api')) {
        return true;
    }

    if (path.includes('/bff')) {
        return true;
    }

    if (path.includes('/graphql')) {
        return true;
    }

    return /\/v\d+\b/.test(path);
}

function normalizeUrl(input: RequestInfo | URL): string {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

    try {
        return new URL(raw, window.location.origin).href;
    } catch {
        return raw;
    }
}

function shouldLogNetwork(url: string, status: number, hasError: boolean): boolean {
    if (hasError) {
        return true;
    }

    if (isViteInternal(url)) {
        return false;
    }

    if (status >= 400) {
        return true;
    }

    if (isCrossOrigin(url)) {
        return true;
    }

    return isApiPath(url);
}

function resolveFetchMethod(input: RequestInfo | URL, init?: RequestInit): string {
    if (init?.method) {
        return init.method.toUpperCase();
    }

    if (typeof input !== 'string' && !(input instanceof URL)) {
        return input.method.toUpperCase();
    }

    return 'GET';
}

function logNetwork(method: string, netUrl: string, status: number, start: number, error?: unknown): void {
    if (!shouldLogNetwork(netUrl, status, error !== undefined)) {
        return;
    }

    const durationMs = Math.round(performance.now() - start);

    if (error !== undefined) {
        sendLog(
            createLog({
                level: 'error',
                type: 'network',
                msg: `${method} ${netUrl} → network error: ${error instanceof Error ? error.message : String(error)}`,
                netUrl,
                method,
                status,
                durationMs,
                stack: getStack(error),
            }),
        );

        return;
    }

    sendLog(
        createLog({
            level: status >= 400 ? 'error' : 'info',
            type: 'network',
            msg: `${method} ${netUrl} → ${status}`,
            netUrl,
            method,
            status,
            durationMs,
        }),
    );
}

export function initNetworkInterceptors(): void {
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const netUrl = normalizeUrl(input);
        const method = resolveFetchMethod(input, init);
        const start = performance.now();

        try {
            const response = await originalFetch.call(window, input, init);
            logNetwork(method, netUrl, response.status, start);

            return response;
        } catch (err) {
            logNetwork(method, netUrl, 0, start, err);
            throw err;
        }
    };

    const xhrMeta = new WeakMap<XMLHttpRequest, {method: string; url: string; start: number}>();

    XMLHttpRequest.prototype.open = function (
        this: XMLHttpRequest,
        method: string,
        url: string | URL,
        async?: boolean,
        username?: string | null,
        password?: string | null,
    ) {
        xhrMeta.set(this, {method: String(method), url: String(url), start: 0});

        // ?? true: XHR.open ожидает boolean, не boolean|undefined
        return originalXhrOpen.call(this, method, url, async ?? true, username ?? null, password ?? null);
    };

    XMLHttpRequest.prototype.send = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
        const meta = xhrMeta.get(this);

        if (meta) {
            meta.start = performance.now();
        }

        // once: true — не накапливаем слушатели при reuse XHR
        this.addEventListener(
            'loadend',
            () => {
                if (meta) {
                    if (this.status === 0) {
                        // status 0 = network failure / abort / timeout → логируем как ошибку
                        logNetwork(
                            meta.method,
                            meta.url,
                            0,
                            meta.start,
                            new Error('network error / aborted / timeout'),
                        );
                    } else {
                        logNetwork(meta.method, meta.url, this.status, meta.start);
                    }
                }
            },
            {once: true},
        );

        return originalXhrSend.call(this, body);
    };
}