/**
 * Утилита для merge-патча `AGENTS.md` плагином при старте dev-сервера.
 *
 * Идемпотентно вставляет блок между маркерами `<!-- vite-agent-bridge:begin -->`
 * и `<!-- vite-agent-bridge:end -->`:
 * - если файл отсутствует — создаёт его со snippet'ом;
 * - если маркеры есть — заменяет блок между ними;
 * - если маркеров нет — добавляет блок в конец файла.
 * Существующее содержимое вне маркеров сохраняется.
 */
import {join} from 'node:path';
import {readFile, writeFile} from 'node:fs/promises';

export const MARKER_START = '<!-- vite-agent-bridge:begin -->';
export const MARKER_END = '<!-- vite-agent-bridge:end -->';

/** Имя файла в корне проекта, который патчим. */
export const AGENTS_MD_FILENAME = 'AGENTS.md';

export interface PatchResult {
    /** Файл был создан с нуля. */
    created: boolean;
    /** Файл был изменён (true) или совпадает со snippet'ом (false). */
    patched: boolean;
}

/** Формирует текст блока для вставки в AGENTS.md. */
export function buildAgentsMdSnippet(port: number): string {
    return [
        MARKER_START,
        '## Vite Agent Bridge',
        '',
        `Dev tooling: \`GET http://localhost:${port}/__agent/manifest\` exposes browser introspection APIs (logs, eval, dom, instances).`,
        MARKER_END,
    ].join('\n');
}

/** Путь к AGENTS.md в корне проекта. */
export function agentsMdPath(projectRoot: string): string {
    return join(projectRoot, AGENTS_MD_FILENAME);
}

/**
 * Идемпотентно патчит AGENTS.md, заменяя или добавляя блок между маркерами.
 *
 * Возвращает `{patched, created}` — для логирования при старте dev-сервера.
 */
export async function patchAgentsMd(projectRoot: string, snippet: string): Promise<PatchResult> {
    const path = agentsMdPath(projectRoot);

    let existing: string;
    try {
        existing = await readFile(path, 'utf8');
    } catch (err) {
        if (isNodeError(err) && err.code === 'ENOENT') {
            await writeFile(path, snippet + '\n', 'utf8');
            return {patched: true, created: true};
        }
        throw err;
    }

    const startIdx = existing.indexOf(MARKER_START);
    const endIdx = existing.indexOf(MARKER_END);

    if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
        const before = existing.slice(0, startIdx);
        const after = existing.slice(endIdx + MARKER_END.length);
        const block = existing.slice(startIdx, endIdx + MARKER_END.length);
        const replacement = before + snippet + after;

        if (block === snippet) {
            return {patched: false, created: false};
        }

        await writeFile(path, replacement, 'utf8');
        return {patched: true, created: false};
    }

    // No markers present — append snippet at the end.
    const sep = existing.length > 0 && !existing.endsWith('\n') ? '\n\n' : '\n';
    await writeFile(path, existing + sep + snippet + '\n', 'utf8');
    return {patched: true, created: false};
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
    return typeof err === 'object' && err !== null && 'code' in err;
}
