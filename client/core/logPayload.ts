/**
 * Фабрика LogPayload: генерирует `ts` и `url`, прокидывая остальные поля.
 */
import type {LogPayload} from '@/types';

export type LogInput = Omit<LogPayload, 'ts' | 'url'> & {url?: string};

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