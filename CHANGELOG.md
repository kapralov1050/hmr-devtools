# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-09-17

### Added
- Multi-instance browser log capture (console, errors, fetch, XHR, Vue)
- HTTP endpoints `/__dev_logs` and `/__dev_exec` with filters
- HTTP endpoints `/__agent/{manifest, instances, dom}` with multi-instance semantics
- `GET /__agent/manifest` runtime manifest with JSON-schema for all tools
- Multi-instance support via `instanceId` (registration, heartbeat, per-instance ring buffer)
- Compact DOM snapshot (`/agent/dom?format=compact`) — `tag#idx[attrs] text` format
- Raw DOM snapshot (`/agent/dom?format=raw`) with attrs/styles/computed/viewportOnly/depth
- 8 `__agent_*` helpers (v-model-safe clickByText, typeByPlaceholder, setValueByPlaceholder, snapshot, findByText, click, waitFor, wait)
- `safeSerialize` with 100 KB cap, cyclic detection, tagged-replacer for Map/Set/Function/BigInt/Symbol
- Client-side exec timeout 5s via `withTimeout` + `ExecTimeoutError`
- AGENTS.md auto-patch via `patchAgentsMd` with merge-markers
- 176 tests across 16 test files; coverage gate (70/70/80/70) enforced in `verify`

### Security
- HMR-only channel: nothing in Network tab except Vite's own WebSocket
- Server-side filters: `level`/`type`/`url`/`text`/`since`/`limit`/`instance`
- Backward-compat: legacy `/__dev_*` endpoints preserved alongside `/__agent/*`
