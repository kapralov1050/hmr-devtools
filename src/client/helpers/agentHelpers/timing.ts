/**
 * Вспомогательные async-операции для agent-helpers:
 * requestAnimationFrame и setTimeout-обёртки.
 */

/** Один кадр анимации (после изменения DOM ждём, пока scheduler отработает). */
export function rafFrame(): Promise<void> {
    return new Promise((resolve) => {
        requestAnimationFrame(() => resolve());
    });
}

/** Async sleep в мс. */
export function waitMs(ms: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}
