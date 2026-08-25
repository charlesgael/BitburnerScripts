# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Scripts for the idle hacking game [Bitburner](https://store.steampowered.com/app/1812820/Bitburner/), written in
TypeScript but run by the game as plain JavaScript. In the game's terminal, scripts are always referenced by their
`.js` name (e.g. `run ui.app.js`), never `.ts`, even though every file here is TypeScript.

There are **two separate source trees** — don't confuse them:

- `src/` — the real, live project. Included in `tsconfig.json`, type-checked, synced into the game by Viteburner.
  This is what you edit.
- `src.prestige/` — a large, unrelated collection of a different author's older Bitburner scripts, kept only as
  reference material (e.g. `src.prestige/player/train.js` was the basis for the Trainer app). It is **not** in
  `tsconfig.json`'s `include`, is not type-checked, and is not deployed. Treat it as read-only prior art, not code
  to maintain — it also predates several NS API renames (see "Known pre-existing issues" below).

## Commands

- **Dev server / deploy**: `npm start` (= `npx viteburner`). Starts the Viteburner remote-file server; in-game,
  enable `Options → Remote API`, set the port it prints (default `12525`), click Connect. Files under `src/` sync
  and transpile to JS automatically — there is no separate manual build step.
- **Type-check**: `npx tsc --noEmit -p tsconfig.json` (or the local binary directly:
  `./node_modules/.bin/tsc.exe --noEmit -p tsconfig.json` on Windows). This is the only real verification command
  in this repo — there is no test suite, and although `eslint`/`prettier` are devDependencies, no config file for
  either exists, so there's nothing to actually run them against.
- `NetscriptDefinitions.d.ts` at the repo root is regenerated/overwritten by Viteburner — don't hand-edit it.

## Known pre-existing issues

`npx tsc --noEmit` currently reports errors in `src/servers.ts`, `src/contracts.app.ts`, `src/init.ts`, and
`src/contracts.lib.ts` — all pre-existing, not something a given change broke. They're all the same root cause: the
game's NS API moved some functions into namespaces since these files were written. Concretely: `getPurchasedServers`
/`purchaseServer`/`deleteServer` moved under `ns.cloud.*`; `tail` moved to `ns.ui.openTail`; `CodingContractData` was
renamed to `CodingContract`. `src.prestige/` has many more instances of this same pattern (old flat Singularity
calls like `ns.gymWorkout` that now live under `ns.singularity.*`) — see `src/daemons/train.daemon.ts` for how one of
those was actually fixed.

## The RAM-cost model (read this before adding any `ns.*` call to `ui.app.ts`)

Bitburner statically analyzes a script's **entire reachable import graph** and charges RAM for every `ns.*` function
*referenced* anywhere in it — whether or not that code path ever runs. This one fact drives several non-obvious
design decisions in this repo:

- A function body that's imported but never called still costs its full RAM. Comments don't count (stripped before
  the analyzer sees them), but live, merely-unreached code does.
- A **local variable or function that happens to share a name with a costed `ns.*` function** can trigger a false
  positive — e.g. a React state setter named `setFocus` or a local `const isBusy = ...` got charged as if they were
  `ns.singularity.setFocus`/`ns.singularity.isBusy`, purely by name collision. If a script's reported RAM looks
  wrong, grep for accidental name collisions with real NS function names before assuming the analyzer is broken.
- Singularity function costs in `NetscriptDefinitions.d.ts` are documented at the *best-case* Source-File 4 discount
  (`RAM cost: X GB * 16/4/1`). Without SF4 levels 2–3, the real cost is 16× that documented number.
- **Consequence**: anything RAM-heavy and only occasionally needed (Singularity actions, `ns.spawn`/`ns.run` for a
  restart button, ...) is split into its own small script, launched on demand via `ns.exec`/`ns.kill` from the
  always-running UI, instead of being referenced directly in `ui.app.ts`'s own reachable code. See
  `src/daemons/train.daemon.ts` and `src/daemons/restart.daemon.ts` — both exist purely to keep `ui.app.js`'s own
  footprint down.

## `ui.app.ts` — the in-game sidebar UI

Entry point that mounts a small React app into the game's own DOM, via the classic `eval("window")`/
`eval("document")` trick (the RAM-free way to reach React/ReactDOM, which the game exposes as globals). Supporting
code lives under `src/ui/`:

- `ui/utils/react-globals.ts` — grabs `React`/`ReactDOM`/`document`/`window`.
- `ui/utils/mount.ts` — creates/reuses the sidebar hook containers this UI lives in. `waitForElement` polls for a
  hook element (e.g. `#sidebar-extra-hook-3`) to exist before mounting into it, since the game's own React sidebar
  isn't guaranteed to have painted it yet the instant this script starts.
- `ui/utils/ns-queue.ts` + `ui/utils/ns-proxy.ts` — **the concurrency layer, load-bearing for the whole app.**
  Bitburner throws a runtime error if two `ns.*` calls from the same script overlap (e.g. a React `onClick` calling
  `ns.*` while the main loop is mid-`ns.sleep`). Anything triggered from a React handler must go through the queued
  proxy (`useQueuedNs()` → an `ns`-shaped object where every call is `await`-able and gets serialized through the
  main loop) rather than touching the real `ns` directly. Only the main loop in `ui.app.ts` (the sole queue
  consumer) is allowed to call the real `ns` directly — including inside `ui/components/overview-stats.ts`'s idle-
  tick refresh, which deliberately takes the raw `ns`, not the proxy, because it *is* that same consumer; routing it
  through the proxy there would deadlock (nothing left to drain the queue while it waits on its own queued call).
- `ui/context/` — React Context providers (`useQueuedNs`, `useAddChildPid`) so apps don't need these threaded
  through every component as props.
- `ui/components/app-grid.ts` — the sidebar icon grid plus the floating windows apps open into: draggable,
  independently closable, no modal backdrop, multiple open at once.
- `ui/components/status-panel.ts` — small floating status line with Restart/Kill buttons.
- `ui/components/overview-stats.ts` — writes into the game's own `#overview-extra-hook-0` cell during main-loop idle
  ticks, from the providers in `ui/stats/registry.ts`.
- `ui/apps/` — pluggable apps shown in the grid, registered in `ui/apps/index.ts`. Each is an
  `AppDefinition { id, icon, label, Content }`, where `Content` is a real React function component (not just a
  render callback) specifically so it can use hooks like `useQueuedNs()`.
- `ui/utils/theme.ts` — reads the player's active in-game color theme via `--bb-theme-*` CSS custom properties
  (with hardcoded fallbacks), so this UI matches whatever theme — including a player-imported one — is active.

## `style.app.ts` — custom CSS injector

Unrelated one-shot script (not React): creates/reuses a `<style id="custom-styles">` element in `<head>` and fills
it from the CSS chunks in `src/style/` (listed in `style/index.ts`). Safe to re-run any time. Existing chunks:
`ui-scale.ts` (global `zoom` to shrink/grow the whole game UI — `zoom`, not `font-size` or `transform: scale`,
because most of the game's own layout is fixed-px, and only `zoom` actually reflows to reclaim the freed space) and
`overview.ts` (restyles the game's default character-overview table, which has no id/class of its own — scoped via
`table:has(#overview-hp-hook)` instead, and per-stat XP bar colors are matched by fixed row position since CSS has
no "previous sibling" selector to look back at a labeled row from its bar row).

## Everything else under `src/`

The rest of `src/` — the top-level `*.app.ts` (application scripts), `*.lib.ts` (shared helpers),
`init.ts`/`map.ts`/`servers.ts` (functional scripts), `src/daemons/` (every `*.daemon.ts` — hack/grow/weaken loops
plus the one-shot daemons `ui.app.ts`'s apps spawn on demand, e.g. `train.daemon.ts`/`restart.daemon.ts`/
`cloud-*.daemon.ts`/`share.daemon.ts`/`spawn-remote.daemon.ts`), and `src/contracts/` (one file per coding-contract
solver) — is the original project this repo was built from. Every daemon deploys to `daemons/<name>.daemon.js` in
the game (Viteburner mirrors `src/`'s own folder structure minus the `src/` prefix), so any `ns.exec`/`ns.run`/
`ns.kill`/`ns.isRunning`/`ns.getScriptRam`/`ns.scp` call referencing one by filename must use that
`daemons/<name>.daemon.js` path, not the bare filename. See `README.md` for the full script list, what each one
does, and its CLI arguments; it's accurate for that part of the tree.
