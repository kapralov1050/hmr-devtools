/* eslint-disable no-console */
/**
 * Перехват console.log/info/warn/error.
 */
import {
    originalConsoleError,
    originalConsoleInfo,
    originalConsoleLog,
    originalConsoleWarn,
    sendLog,
} from '@/core';
import {createLog, findError, formatArgs, getStack} from '@/helpers';

export function initConsoleInterceptors(): void {
    console.log = (...args: unknown[]) => {
        originalConsoleLog(...args);
        sendLog(createLog({level: 'log', type: 'console', msg: formatArgs(args)}));
    };

    console.info = (...args: unknown[]) => {
        originalConsoleInfo(...args);
        sendLog(createLog({level: 'info', type: 'console', msg: formatArgs(args)}));
    };

    console.warn = (...args: unknown[]) => {
        const formatted = formatArgs(args);

        originalConsoleWarn(...args);
        sendLog(createLog({level: 'warn', type: 'console', msg: formatted}));
    };

    console.error = (...args: unknown[]) => {
        originalConsoleError(...args);
        sendLog(createLog({level: 'error', type: 'console', msg: formatArgs(args), stack: getStack(findError(args))}));
    };
}
