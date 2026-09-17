/**
 * Чистые форматтеры для аргументов console.log и Promise-reason.
 */
export const maxArgLen = 2000;

export function formatArgs(args: unknown[]): string {
    return args
        .map((arg) => {
            if (typeof arg === 'string') {
                return arg.length > maxArgLen ? arg.slice(0, maxArgLen) + '…' : arg;
            }

            if (arg instanceof Error) {
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