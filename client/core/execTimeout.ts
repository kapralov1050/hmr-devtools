/**
 * Promise-обёртка с client-side таймаутом для eval (`dev-exec`).
 *
 * Если оригинальный promise не резолвится за `timeoutMs` —
 * отклоняем его собственной ошибкой `Execution timed out after Nms`.
 * Таймер всегда чистится (и при успехе, и при ошибке оригинала).
 */

export class ExecTimeoutError extends Error {
    public readonly timeoutMs: number;
    public readonly hint: string | undefined;

    constructor(timeoutMs: number, hint?: string) {
        super(`Execution timed out after ${timeoutMs}ms`);
        this.name = 'ExecTimeoutError';
        this.timeoutMs = timeoutMs;
        this.hint = hint;
    }
}

export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, hint?: string): Promise<T> {
    if (timeoutMs <= 0) {
        return Promise.reject(new ExecTimeoutError(timeoutMs, hint));
    }

    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new ExecTimeoutError(timeoutMs, hint));
        }, timeoutMs);

        promise.then(
            (value) => {
                clearTimeout(timer);
                resolve(value);
            },
            (err) => {
                clearTimeout(timer);
                reject(err instanceof Error ? err : new Error(String(err)));
            },
        );
    });
}
