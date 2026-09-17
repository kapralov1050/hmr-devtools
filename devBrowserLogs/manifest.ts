/**
 * Серверная обработка `GET /__agent/manifest`.
 *
 * Отдаёт агентам JSON со схемами всех доступных инструментов:
 * `browser_logs`, `browser_eval`, `browser_dom`, `browser_instances`.
 * Манифест декларирует capabilities, даже если соответствующий эндпоинт
 * ещё не реализован (помечается в `description` суффиксом "(planned)").
 */
import type http from 'node:http';
import {agentDomEndpoint, agentEvalEndpoint, agentInstancesEndpoint} from '../devLogger/constants';
import type {Manifest, ManifestTool} from '../devLogger/types';
import packageJson from '../package.json' with {type: 'json'};
import type {DevLogsContext} from './types';

/** `name` плагина, отдаваемый в манифесте (фиксированная метка, не из package.json). */
const PLUGIN_NAME = 'vite-agent-bridge';

/** Подсказка, вставляемая в LLM-контекст агента. */
const SYSTEM_HINT = 'When debugging browser issues, prefer /__agent/* over guessing.';

/** Список capability-флагов для быстрой ориентации агента. */
const CAPABILITIES = ['logs', 'eval', 'dom', 'instances'] as const;

const TOOLS: readonly ManifestTool[] = [
    {
        name: 'browser_logs',
        description: 'Read dev log buffer with filters (level, type, url, text, since, limit).',
        endpoint: 'GET /__dev_logs',
        input_schema: {
            type: 'object',
            properties: {
                level: {type: 'string', enum: ['debug', 'info', 'warn', 'error']},
                type: {type: 'string'},
                url: {type: 'string', description: 'substring match'},
                text: {type: 'string', description: 'case-insensitive'},
                since: {type: 'string', format: 'date-time'},
                limit: {type: 'integer', minimum: 1},
            },
        },
    },
    {
        name: 'browser_eval',
        description: `Evaluate JS in page context, return serialized result. (planned; endpoint ${agentEvalEndpoint})`,
        endpoint: `POST ${agentEvalEndpoint}`,
        input_schema: {
            type: 'object',
            required: ['code'],
            properties: {
                code: {type: 'string'},
                timeout: {type: 'integer', minimum: 100, default: 5000},
            },
        },
    },
    {
        name: 'browser_dom',
        description: `Snapshot of DOM — compact (~80 lines) or raw (with attrs/computed styles). (planned; endpoint ${agentDomEndpoint})`,
        endpoint: `GET ${agentDomEndpoint}`,
        input_schema: {
            type: 'object',
            properties: {
                format: {type: 'string', enum: ['compact', 'raw'], default: 'compact'},
                selector: {type: 'string'},
                depth: {type: 'integer', default: 5},
                attrs: {type: 'string', enum: ['all', 'interactive', 'none'], default: 'interactive'},
                styles: {type: 'string', enum: ['none', 'inline', 'computed'], default: 'none'},
                viewportOnly: {type: 'boolean', default: false},
                maxSize: {type: 'integer', default: 500000},
            },
        },
    },
    {
        name: 'browser_instances',
        description: `List active browser instances (tabs). (planned; endpoint ${agentInstancesEndpoint})`,
        endpoint: `GET ${agentInstancesEndpoint}`,
        input_schema: {type: 'object', properties: {}},
    },
] as const;

const EXAMPLES: readonly string[] = [
    'GET /__agent/manifest',
    `POST ${agentEvalEndpoint} {"code":"document.title"}`,
    `GET ${agentDomEndpoint}?format=compact`,
    `GET ${agentInstancesEndpoint}`,
];

/**
 * Собирает объект `Manifest`. `port` и `instanceCount` опциональны — если не переданы,
 * соответствующие поля в манифесте отсутствуют.
 */
export function buildManifest(port: number | null = null, instanceCount: number | null = null): Manifest {
    const manifest: Manifest = {
        v: 1,
        name: PLUGIN_NAME,
        version: packageJson.version,
        system_hint: SYSTEM_HINT,
        capabilities: [...CAPABILITIES],
        tools: TOOLS.map((t) => ({...t})),
        examples: [...EXAMPLES],
    };

    if (port !== null) {
        manifest.port = port;
    }
    if (instanceCount !== null) {
        manifest.instances = instanceCount;
    }

    return manifest;
}

/** Извлекает порт из `host`-заголовка вида `host:port`; возвращает `null`, если не удаётся. */
function portFromHost(hostHeader: string | undefined): number | null {
    if (typeof hostHeader !== 'string' || hostHeader.length === 0) {
        return null;
    }

    const colon = hostHeader.lastIndexOf(':');
    if (colon === -1) {
        return null;
    }

    const raw = hostHeader.slice(colon + 1);
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 && n <= 65535 ? n : null;
}

/** HTTP-обработчик `GET /__agent/manifest`. */
export function handleManifest(req: http.IncomingMessage, res: http.ServerResponse, ctx?: DevLogsContext): void {
    try {
        const port = portFromHost(req.headers.host);
        const instanceCount = ctx ? ctx.instances.size : null;
        const manifest = buildManifest(port, instanceCount);

        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify(manifest));
    } catch {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({error: 'Internal error'}));
    }
}
