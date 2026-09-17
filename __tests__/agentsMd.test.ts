/**
 * Unit tests for `devBrowserLogs/agentsMd.ts`:
 * `buildAgentsMdSnippet`, `agentsMdPath`, `patchAgentsMd` merge-логика.
 *
 * Используем `node:os.tmpdir()` + `node:fs/promises` для изоляции от корневого AGENTS.md.
 */
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
    AGENTS_MD_FILENAME,
    MARKER_END,
    MARKER_START,
    agentsMdPath,
    buildAgentsMdSnippet,
    patchAgentsMd,
} from '../server/agentsMd';

describe('buildAgentsMdSnippet', () => {
    it('contains both markers', () => {
        const snippet = buildAgentsMdSnippet(5173);
        expect(snippet).toContain(MARKER_START);
        expect(snippet).toContain(MARKER_END);
        expect(snippet.indexOf(MARKER_START)).toBeLessThan(snippet.indexOf(MARKER_END));
    });

    it('includes the manifest URL with the given port', () => {
        const snippet = buildAgentsMdSnippet(4321);
        expect(snippet).toContain('http://localhost:4321/__agent/manifest');
    });

    it('interpolates the given port into the manifest URL', () => {
        expect(buildAgentsMdSnippet(3000)).toContain(':3000/__agent/manifest');
        expect(buildAgentsMdSnippet(8080)).toContain(':8080/__agent/manifest');
    });
});

describe('agentsMdPath', () => {
    it('joins root + AGENTS_MD_FILENAME', () => {
        expect(agentsMdPath('/some/root')).toBe(join('/some/root', AGENTS_MD_FILENAME));
    });
});

describe('patchAgentsMd', () => {
    let dir: string;

    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), 'agents-md-test-'));
    });

    afterEach(async () => {
        await rm(dir, {recursive: true, force: true});
    });

    it('a) creates AGENTS.md with snippet when file does not exist', async () => {
        const result = await patchAgentsMd(dir, buildAgentsMdSnippet(5173));

        expect(result.created).toBe(true);
        expect(result.patched).toBe(true);

        const content = await readFile(agentsMdPath(dir), 'utf8');
        expect(content).toContain(MARKER_START);
        expect(content).toContain(MARKER_END);
        expect(content).toContain('http://localhost:5173/__agent/manifest');
    });

    it('b) appends marker block to existing file without markers', async () => {
        const original = '# My Project\n\nUser content here.\n';
        await writeFile(agentsMdPath(dir), original, 'utf8');

        const result = await patchAgentsMd(dir, buildAgentsMdSnippet(5173));

        expect(result.created).toBe(false);
        expect(result.patched).toBe(true);

        const content = await readFile(agentsMdPath(dir), 'utf8');
        expect(content.startsWith(original)).toBe(true);
        expect(content).toContain(MARKER_START);
        expect(content).toContain(MARKER_END);
    });

    it('c) replaces block between markers while preserving user content outside', async () => {
        const oldSnippet = [
            MARKER_START,
            '## Vite Agent Bridge',
            '',
            'OLD CONTENT',
            MARKER_END,
        ].join('\n');
        const original = `# My Project\n\nUser keeps this.\n\n${oldSnippet}\n\nTrailing user content.\n`;
        await writeFile(agentsMdPath(dir), original, 'utf8');

        const newSnippet = buildAgentsMdSnippet(4321);
        const result = await patchAgentsMd(dir, newSnippet);

        expect(result.created).toBe(false);
        expect(result.patched).toBe(true);

        const content = await readFile(agentsMdPath(dir), 'utf8');
        expect(content).toContain('User keeps this.');
        expect(content).toContain('Trailing user content.');
        expect(content).not.toContain('OLD CONTENT');
        expect(content).toContain('http://localhost:4321/__agent/manifest');
        expect(content).toContain(MARKER_START);
        expect(content).toContain(MARKER_END);
        // Marker block replaced exactly once.
        expect(content.split(MARKER_START)).toHaveLength(2);
        expect(content.split(MARKER_END)).toHaveLength(2);
    });

    it('d) no-op when marker block already matches new snippet', async () => {
        const snippet = buildAgentsMdSnippet(5173);
        const original = `# Title\n\n${snippet}\n`;
        await writeFile(agentsMdPath(dir), original, 'utf8');

        const result = await patchAgentsMd(dir, snippet);

        expect(result.patched).toBe(false);
        expect(result.created).toBe(false);

        const content = await readFile(agentsMdPath(dir), 'utf8');
        expect(content).toBe(original);
    });

    it('e) preserves user content outside the marker block', async () => {
        const snippet = buildAgentsMdSnippet(5173);
        const userSection = '# Rules\n\nDo not touch this.\n\nAnother line.\n';
        const original = `${userSection}\n${snippet}\n`;
        await writeFile(agentsMdPath(dir), original, 'utf8');

        const updatedSnippet = buildAgentsMdSnippet(9000);
        const result = await patchAgentsMd(dir, updatedSnippet);

        expect(result.patched).toBe(true);

        const content = await readFile(agentsMdPath(dir), 'utf8');
        expect(content).toContain('Do not touch this.');
        expect(content).toContain('Another line.');
        expect(content).toContain(':9000/__agent/manifest');
    });
});
