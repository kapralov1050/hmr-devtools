/**
 * Извлечение метаданных из Error / Vue-инстанса для логирования.
 */
import type {ComponentPublicInstance} from 'vue';

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

export function getComponentName(instance: ComponentPublicInstance | null): string | undefined {
    return instance?.$options?.name ?? undefined;
}