/**
 * Ambient shim for `vue` (peer dep of devLogger/vueInterceptor.ts).
 * Полные типы Vue не нужны для typecheck плагина — достаточно базовых,
 * чтобы удовлетворить `import type { App, ComponentPublicInstance } from 'vue'`.
 * Реальные потребители подключают vue как dev-dep своего приложения.
 */
declare module 'vue' {
    export interface ComponentPublicInstance {
        $options?: {name?: string};
    }
    export interface App {
        config: {
            errorHandler?: ((err: unknown, instance: ComponentPublicInstance | null, info: string) => void) | null | undefined;
            warnHandler?: ((msg: unknown, instance: ComponentPublicInstance | null, trace: unknown) => void) | null | undefined;
        };
    }
}