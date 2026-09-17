/**
 * Перехват window.onerror (capture phase), unhandledrejection, ошибок ресурсов.
 */
import {addTrackedListener, flushDuplicates, sendLog} from '@/core';
import {createLog, formatReason, getStack} from '@/helpers';

function getElementSrc(el: Element): string {
    if (el instanceof HTMLImageElement || el instanceof HTMLScriptElement) {
        return el.src;
    }

    if (el instanceof HTMLLinkElement) {
        return el.href;
    }

    if (el instanceof HTMLMediaElement) {
        return el.currentSrc || el.src;
    }

    if (el instanceof HTMLIFrameElement) {
        return el.src;
    }

    if (el instanceof HTMLSourceElement) {
        return el.src;
    }

    return '';
}

export function initGlobalErrorInterceptors(): void {
    // Capture phase: ловит ошибки загрузки ресурсов (img/script/css 404),
    // которые не всплывают до window в bubble phase.
    addTrackedListener(
        'error',
        (event: Event) => {
            // Ресурсные ошибки (img/script/css 404) диспатчатся как Event с target=элементом,
            // НЕ как ErrorEvent — поэтому проверяем target первым, в capture phase.
            const target = event.target;

            if (target instanceof Element && target.tagName) {
                const tag = target.tagName.toLowerCase();
                const src = getElementSrc(target);
                sendLog(
                    createLog({
                        level: 'error',
                        type: 'resource',
                        msg: `Failed to load <${tag}> ${src}`,
                        netUrl: src || undefined,
                    }),
                );

                return;
            }

            if (event instanceof ErrorEvent) {
                sendLog(
                    createLog({
                        level: 'error',
                        type: 'window.onerror',
                        msg: event.message,
                        stack: event.error instanceof Error ? event.error.stack : undefined,
                    }),
                );
            }
        },
        true,
    );

    addTrackedListener(
        'unhandledrejection',
        (event: Event) => {
            if (event instanceof PromiseRejectionEvent) {
                const reason = event.reason;
                sendLog(
                    createLog({
                        level: 'error',
                        type: 'unhandledrejection',
                        msg: formatReason(reason),
                        stack: getStack(reason),
                    }),
                );
            }
        },
        false,
    );

    // Флаш хвостовых дубликатов и pending-буфера при уходе со страницы
    addTrackedListener('pagehide', () => flushDuplicates(), false);
}
