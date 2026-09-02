# AGENTS.md — canvas-harness

Canvas-rendered node-graph library (React Flow's API, Excalidraw's perf ceiling, TipTap's
extensibility). Headless, styleless. pnpm monorepo. Pitch + usage: `README.md`.

This is the single source of truth for working in this repo. Package-specific rules live in
additive `packages/*/AGENTS.md` files (loaded when you open that package). Design docs are linked,
never restated here — read them on demand.

## Commands

Package manager **pnpm@9.15.0** (pinned via `packageManager`), Node **>=20**. Run from repo root:

| Task | Command |
|---|---|
| Build all packages | `pnpm build` (tsup → ESM+CJS+d.ts) |
| Unit tests | `pnpm test` (vitest, per package) |
| Browser tests | `pnpm test:browser` (vitest + playwright/chromium; `core` & `react` only) |
| Typecheck | `pnpm typecheck` |
| Lint | `pnpm lint` (`biome check .`) |
| Format | `pnpm format` (`biome format --write .`) |
| Dev / playground | `pnpm dev` (runs `examples/playground`, Vite) |

- **Build before typecheck/test in a clean tree** — cross-package types resolve through built
  `dist/*.d.ts` (this is why CI builds first).
- Browser tests need chromium once: `pnpm -F @canvas-harness/react exec playwright install --with-deps chromium`.
- Single package: add `-F @canvas-harness/core` (or `react` / `sync-broadcast`).

## Conventions

Enforced by `biome.json` + `tsconfig.base.json` — run `pnpm format` and `pnpm lint` before finishing.
What differs from language defaults (the rest, just write idiomatic TS):

- **No semicolons** (`asNeeded`). **Single quotes** in TS, **double quotes** in JSX. **Trailing
  commas everywhere.** Arrow parens omitted for a single arg (`x => x`). 2-space indent, width 100, LF.
- **`import type`** is mandatory for type-only imports (`verbatimModuleSyntax`).
- **No `any`** (`noExplicitAny: error`), no unused imports/locals/params. `console.log` warns.
  Non-null `!` is allowed. Imports are auto-organized.
- TS is `strict` **plus** `noUncheckedIndexedAccess`, `noImplicitOverride`, `noImplicitReturns`,
  `noFallthroughCasesInSwitch` — indexing an array gives `T | undefined`, handle it.
- Biome only touches `packages/*/{src,tests}` and `examples/*/src`. `dim0/`, `dist/` are out of scope.

## Repo map

```
packages/
  core/            @canvas-harness/core — framework-agnostic engine (store, renderer, edges,
                   hit-test, ops/history, text, ai). ~13.7k LOC. See packages/core/AGENTS.md.
  react/           @canvas-harness/react — <Canvas>/<CanvasProvider> + data/interaction/presence/
                   history hooks. ~2.9k LOC.
  sync-broadcast/  @canvas-harness/sync-broadcast — BroadcastChannel SyncAdapter (multi-tab demos).
examples/playground/  the dev app `pnpm dev` launches (Vite + React 19). NOT dim0.
docs/            design docs — see below. perf/ perf baselines + fixtures. scripts/ bump-version.mjs.
dim0/            SEPARATE product ("Dim0 - The Thinking Canvas"). NOT in the pnpm workspace, NOT this
                 library. It *consumes* the published packages. Don't edit it when working on the lib.
```

Workspaces = `packages/*` + `examples/*` (`pnpm-workspace.yaml`). All 3 packages at v0.1.25.

### `@canvas-harness/react` public surface

`<Canvas tool=...>` (`'select'` / `'arrow'` / `'ink'` / `'eraser'` handled internally; any other string falls through to
`onClick`/`onCreateDrag`), `<CanvasProvider store>`, `<Minimap>`, `useCanvasStore`, and selector
hooks: `useNode(s)`, `useEdge(s)`, `useSelection`, `useCamera`, `useInteractionState`/`Mode`/`useCursor`/
`useIsMoving`/`useDraggedIds`, `useLocalPresence`/`usePresence`, `useCanUndo`/`useCanRedo`. Hooks
subscribe narrowly (a `useNode(id)` re-renders only when that node changes) — keep that granularity.

## Design docs (link, don't duplicate)

- `docs/ARCHITECTURE.md` — the WHAT: data model, rendering model, edges, interaction, extensibility.
- `docs/IMPLEMENTATION.md` — the HOW: tool choices (tsup/vite/vitest/biome/signia) + phased build.
- `docs/IMPROVEMENTS.md` — deferred perf/polish backlog (sized XS–L).

Architecture facts belong in those files. If you learn a durable *why*, add it there (or an ADR),
not here.

## Gotchas (cross-cutting — the ones that bite)

These are behavioral traps not obvious from the code. Rendering/store internals are in
`packages/core/AGENTS.md`.

- **View state ≠ document state.** Camera, selection, hover, interaction mode are *view* state.
  Never wire them into the document save/sync/op bus — it tanks FPS and is semantically wrong.
- **Pan/zoom must set `interaction.mode`.** `use-pan-zoom` (react/internal) MUST write the interaction
  mode on every motion; every downstream motion-LOD decision reads it. Silent to miss, breaks LOD.
- **Cross-event gesture flags live in component-scope `useRef`**, not inside a `useEffect`. Flags like
  `justCommittedRef` reset on prop-driven remounts if scoped to the effect.
- **Image/icon resize does NOT lock aspect by default.** Free resize; shift constrains (standard
  editor behavior). Don't add a default aspect lock for image/icon node types.
- **The renderer's sorted-(z,id) paint cache invalidates only on document `'change'`** — never on
  camera/selection/interaction. If you add a field that affects paint order, it must flow through a
  document op or the cache goes stale. (Details in `packages/core/AGENTS.md`.)

## PRs & commits

- CI (`.github/workflows/ci.yml`) runs on PRs to `main` and gates merge on **lint + typecheck + unit
  tests + browser tests + dist build**. Make all of `pnpm lint`, `pnpm typecheck`, `pnpm test` pass.
- Release is **manual only** (`workflow_dispatch`, `release.yml` → OIDC npm publish + tag). Don't bump
  versions or tag as part of feature work.
- Don't commit unless asked; when you do and you're on `main`, branch first.
