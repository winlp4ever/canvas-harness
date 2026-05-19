# canvas-harness

A high-performance, canvas-rendered node-graph library — react-flow's API, Excalidraw's perf ceiling, tiptap's NodeView extensibility, headless and styleless.

> **Status: phase 0** — scaffolding only. The real renderer arrives in phase 2, edges in phase 4, edit mode in phase 7. Not yet usable.

## What this is

- **Canvas-rendered**: built-in shapes draw directly into a canvas, not the DOM. Reconciliation is not on the per-frame critical path.
- **DOM overlay for custom nodes**: when you need iframes, charts, videos, or arbitrary React components, mount them in an overlay layer that shares the camera transform.
- **Headless**: the library owns geometry, hit-testing, transforms, caching, edges. It doesn't own visual style — every color/font/radius is a theme token.
- **Collab-ready bones**: typed `Op` log, presence slice, `SyncAdapter` interface. Ships no concrete sync transport — plug in your own (Yjs, WebSocket, BroadcastChannel).
- **AI-friendly**: `api.getContext({ format: "markdown" })` returns canvas state for direct LLM injection. The op log doubles as the tool-call schema for write-side mutations.

## Documentation

- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — what the library is and why. Data model, rendering pipeline, edge system, edit mode, state/store, full API surface. Every decision has a stated rationale.
- [`IMPLEMENTATION.md`](./IMPLEMENTATION.md) — how it gets built. 14-week phased plan with deliverables, tooling decisions, perf harness, CI workflow.

## Packages

| Package                  | Description                                         |
|--------------------------|-----------------------------------------------------|
| `@canvas-harness/core`   | Framework-agnostic core. Store, renderer, ops, hit-testing. |
| `@canvas-harness/react`  | React bindings: `<Canvas>` component and hooks.     |

## Workspace layout

```
canvas-harness/
├─ packages/
│  ├─ core/                 # @canvas-harness/core
│  └─ react/                # @canvas-harness/react
├─ examples/
│  └─ playground/           # vite + react sandbox for manual testing
├─ perf/                    # vitest browser-mode perf scenarios + baselines
├─ ARCHITECTURE.md
└─ IMPLEMENTATION.md
```

## Local development

```bash
pnpm install              # install deps across the workspace
pnpm dev                  # launches the playground at localhost:5173
pnpm test                 # vitest unit tests across all packages
pnpm test:browser         # vitest in real Chromium (Playwright internally)
pnpm build                # tsup builds all packages to dist/
pnpm lint                 # biome check
pnpm typecheck            # tsc --noEmit across the workspace
```

Requires Node 20+ and pnpm 9+.

## License

[MIT](./LICENSE)
