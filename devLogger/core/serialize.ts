/**
 * Безопасная сериализация значений, возвращаемых из eval (`dev-exec`) и
 * других dev-only каналов.
 *
 * Защищает от:
 *  - циклических ссылок (JSON.stringify бросает → ловим в catch);
 *  - тихих потерь для Map / Set / Function / BigInt / Symbol (явные теги);
 *  - «взрывных» по размеру результатов (cap на maxBytes, truncation).
 *
 * maxBytes по умолчанию = `defaultMaxSerializedBytes` (100 KB).
 */
import {defaultMaxSerializedBytes} from '@/constants';

type SafeOk = {ok: true; value: string};
type SafeErr = {ok: false; error: string; hint?: string};
export type SafeSerializeResult = SafeOk | SafeErr;

const PREVIEW_PREFIX_CHARS = 256;
const TRUNCATE_MARKER_FMT = (maxBytes: number): string => `…<truncated at ${maxBytes} bytes>`;

type ReplacerType = 'Map' | 'Set' | 'Function' | 'BigInt' | 'Symbol';
interface TaggedRepr extends Record<string, unknown> {
    __type: ReplacerType;
}

/**
 * JSON-replacer, превращающий «непрозрачные» для JSON значения
 * в явные tagged-структуры. Циклические ссылки НЕ ловим здесь —
 * пусть JSON.stringify бросит, и `safeSerialize` вернёт `{ok:false}`.
 */
function makeReplacer(): (key: string, val: unknown) => unknown {
    return (_key: string, val: unknown): unknown => {
        if (val instanceof Map) {
            return {__type: 'Map', entries: Array.from(val.entries())} satisfies TaggedRepr;
        }
        if (val instanceof Set) {
            return {__type: 'Set', values: Array.from(val.values())} satisfies TaggedRepr;
        }
        if (typeof val === 'function') {
            return {__type: 'Function', name: val.name === '' ? 'anonymous' : val.name} satisfies TaggedRepr;
        }
        if (typeof val === 'bigint') {
            return {__type: 'BigInt', value: String(val)} satisfies TaggedRepr;
        }
        if (typeof val === 'symbol') {
            return {__type: 'Symbol', description: val.description ?? null} satisfies TaggedRepr;
        }
        return val;
    };
}

/**
 * Возвращает JSON-строку, ограниченную `maxBytes` символами.
 * Если строка не помещается — обрезает head и дописывает короткий маркер,
 * чтобы итоговая длина НЕ превышала `maxBytes`.
 */
export function truncatePreview(value: unknown, maxBytes: number): string {
    const replacer = makeReplacer();
    let s: string;
    try {
        s = JSON.stringify(value, replacer) ?? String(value);
    } catch {
        s = String(value);
    }
    if (s.length <= maxBytes) {
        return s;
    }
    const marker = TRUNCATE_MARKER_FMT(maxBytes);
    const headBudget = Math.max(0, maxBytes - marker.length);
    return `${s.slice(0, headBudget)}${marker}`;
}

function serializeTruncated(value: unknown, maxBytes: number): string {
    const previewBudget = Math.min(PREVIEW_PREFIX_CHARS, maxBytes);
    const previewSource = truncatePreview(value, previewBudget);
    const payload = {
        __truncated__: true,
        sizeBytes: previewSource.length,
        preview: previewSource,
        maxBytes,
    };
    return JSON.stringify(payload);
}

/**
 * Безопасно сериализует значение в JSON-строку.
 *
 * Не бросает. При циклах возвращает `{ok:false, error:'Cyclic structure'}`.
 * `undefined` сериализуется как пустая строка (как `JSON.stringify(undefined)`).
 * При превышении лимита — возвращает `{ok:true, value: <truncated marker>}`.
 */
export function safeSerialize(value: unknown, maxBytes: number = defaultMaxSerializedBytes): SafeSerializeResult {
    const replacer = makeReplacer();

    let json: string;
    try {
        json = JSON.stringify(value, replacer) ?? '';
    } catch (e) {
        if (e instanceof Error && /circular/i.test(e.message)) {
            return {
                ok: false,
                error: 'Cyclic structure',
                hint: 'Convert circular refs to plain objects before returning',
            };
        }
        return {
            ok: false,
            error: e instanceof Error ? e.message : String(e),
            hint: 'Value is not JSON-serializable; return a plain object',
        };
    }

    if (json.length > maxBytes) {
        return {ok: true, value: serializeTruncated(value, maxBytes)};
    }

    return {ok: true, value: json};
}
