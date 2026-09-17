/**
 * Чистые хелперы dev-логгера: форматирование, фабрика лог-записей, извлечение метаданных.
 * Не зависят от модульного состояния core.ts.
 */
import type {ComponentPublicInstance} from 'vue';
import type {LogPayload} from '@/utils/devLogger/types';

export type LogInput = Omit<LogPayload, 'ts' | 'url'> & {url?: string};

const maxArgLen = 2000;

function nowTs(): string {
    return new Date().toISOString();
}

function pageUrl(): string {
    return window.location.pathname + window.location.search + window.location.hash;
}

export function createLog(input: LogInput): LogPayload {
    const {url, ...rest} = input;

    return {ts: nowTs(), url: url ?? pageUrl(), ...rest};
}

export function formatArgs(args: unknown[]): string {
    return args
        .map((arg) => {
            if (typeof arg === 'string') {
                return arg.length > maxArgLen ? arg.slice(0, maxArgLen) + '…' : arg;
            }

            if (arg instanceof Error) {
                // Для msg используем message (не stack) — stack идёт в отдельное поле.
                const s = arg.message;

                return s.length > maxArgLen ? s.slice(0, maxArgLen) + '…' : s;
            }

            try {
                const s = JSON.stringify(arg);

                if (s === undefined) {
                    return 'undefined';
                }

                return s.length > maxArgLen ? s.slice(0, maxArgLen) + '…' : s;
            } catch {
                return String(arg);
            }
        })
        .join(' ');
}

export function getStack(error?: unknown): string | undefined {
    if (error instanceof Error) {
        return error.stack;
    }

    return undefined;
}

export function findError(args: unknown[]): Error | undefined {
    for (const arg of args) {
        if (arg instanceof Error) {
            return arg;
        }
    }

    return undefined;
}

export function formatReason(reason: unknown): string {
    let s: string;

    if (reason instanceof Error) {
        s = reason.message;
    } else if (typeof reason === 'string') {
        s = reason;
    } else {
        try {
            s = JSON.stringify(reason) ?? String(reason);
        } catch {
            s = String(reason);
        }
    }

    return s.length > maxArgLen ? s.slice(0, maxArgLen) + '…' : s;
}

export function getComponentName(instance: ComponentPublicInstance | null): string | undefined {
    return instance?.$options?.name ?? undefined;
}
