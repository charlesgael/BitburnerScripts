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

## The RAM-cost model (read this before adding any `ns.*` call anywhere in `src/ui/` or `src/cgd/`)

Bitburner statically analyzes a script's **entire reachable import graph** and charges RAM for every `ns.*` function
*referenced* anywhere in it — whether or not that code path ever runs. This one fact drives several non-obvious
design decisions in this repo, and it's more aggressive than it first looks:

- A function body that's imported but never called still costs its full RAM. Comments don't count (stripped before
  the analyzer sees them), but live, merely-unreached code does.
- **The match is on identifier *text*, not on the receiver's real type or role.** It's not "a literal `ns.foo(...)`
  call" — it's "any identifier that lexically equals a real `ns.*` function name, appearing *anywhere* as a call, a
  property access, or even a bare local variable declaration with nothing to do with `ns` at all." Two real
  instances this project hit: `ui/utils/ns-queue.ts`'s own history (`queue.run(...)` billed as `ns.run`, despite
  `queue` not being `ns`), and `ui.app.js` silently carrying `ns.share()`'s 2.4GB because one file had
  `const share = useShare(...)` — a variable name, never even called as `.share(`. If a script's reported RAM looks
  wrong, grep for *any* identifier — call, property, or bare variable — matching a real NS function name, not just
  literal `ns.something(` call sites.
- **This is why `ui/utils/ns-proxy.ts`'s `QueuedNS` exposes every method `_`-prefixed** (`queuedNs._exec(...)`, not
  `.exec(...)`) — see that file's header comment. Every app's `ns.*` calls go through this proxy already (queued,
  serialized — see the daemon section below), and writing them with ordinary syntax was silently billing every
  method any app called to whatever script imported that app, defeating the entire point of routing through a
  daemon. `QueuedNS`'s type only exposes the prefixed names, so forgetting the `_` is a compile error, not a
  RAM surprise found the hard way (which is exactly how this was discovered — see `docs/epic-cgd-namespace.md`'s
  "Validated assumptions" for the full story, including a decoy-reference trick used deliberately elsewhere: a
  `void ns.someMethod;` reference with nothing calling it is enough to reserve RAM for it without ever invoking it).
- **A *computed* property access (`receiver[method](...args)`, `method` a runtime string) has no literal text to
  match, so it doesn't inflate the *static* allocation** — this is what `cgd/dispatch.ts`'s `dispatchCall` relies
  on. But Bitburner *also* tracks actual dynamic `ns.*` usage at **runtime** and kills the whole script with a
  "RAM USAGE ERROR ... you somehow circumvented the static RAM calculation" the instant that usage exceeds what was
  statically reserved. So dynamic dispatch doesn't make a call free — it just makes it invisible to the static
  allocator, which is dangerous, not helpful, unless something else in that same script's reachable text reserves
  for it too (see the tiered-daemon allow-lists below). Don't reach for computed dispatch as a RAM-avoidance trick
  without reading `cgd/dispatch.ts`'s header comment first.
- Singularity function costs in `NetscriptDefinitions.d.ts` are documented at the *best-case* Source-File 4 discount
  (`RAM cost: X GB * 16/4/1`). Without SF4 levels 2–3, the real cost is 16× that documented number.
- **Consequence**: the primary mechanism for keeping `ui.app.js` cheap is now the tiered `cgd` daemon (see below),
  not one-shot scripts spawned on demand — but that older pattern still exists and is still correct for anything
  that genuinely needs its own independent, long-running, unrestricted-`ns` process rather than a queued call (a
  loop that must keep running regardless of what the UI does). `src/daemons/train.daemon.ts` is the current example
  — Singularity actions gated on SF4/BitNode-4, deliberately kept outside the tiered daemon system (see
  `docs/epic-cgd-namespace.md` for why tier 4 was planned for this and then decided against).

## `ui.app.ts` — the in-game sidebar UI

Entry point that mounts a small React app into the game's own DOM, via the classic `eval("window")`/
`eval("document")` trick (the RAM-free way to reach React/ReactDOM, which the game exposes as globals). **It mounts
once and exits — it does not keep a loop running.** All `ns.*` access apps need goes through a separately-running,
persistent daemon reached via `window.cgd` (see the next section); `ui.app.ts` itself calls only a couple of free
(0GB) `ns.*` functions directly in its own brief `main()` (`disableLog`, `tprint`, `args`). Supporting code lives
under `src/ui/`:

- `ui/utils/react-globals.ts` — grabs `React`/`ReactDOM`/`document`/`window`.
- `ui/utils/mount.ts` — creates/reuses the sidebar hook containers this UI lives in. `waitForElement` polls for a
  hook element (e.g. `#sidebar-extra-hook-3`) to exist before mounting into it, since the game's own React sidebar
  isn't guaranteed to have painted it yet the instant this script starts. `startReattachGuardian` runs a plain
  `setInterval` (no `ns` cost) to re-attach a container if the game's own sidebar tears down and rebuilds the hook
  it lives in — this, and everything else here that's a periodic *plain-JS* check unrelated to `ns`, deliberately
  doesn't need the daemon at all.
- `ui/utils/ns-proxy.ts` — wraps a *live* "current daemon" getter (`() => cgd.daemon`, re-resolved on every call —
  see the daemon section) in a Proxy that reads like calling `ns` directly, `_`-prefixed (see the RAM-cost model
  section above for why). `useQueuedNs()` (`ui/context/ns-queue-context.ts`) is how a component gets one.
- `ui/context/` — React Context providers (`useQueuedNs`, `useAddChildPid`, `useHomeRam`, `useDaemonTier`,
  `useCgdActions`) so apps don't need these threaded through every component as props.
- `ui/components/app-grid.tsx` — the sidebar icon grid plus the floating windows apps open into: draggable,
  independently closable, no modal backdrop, multiple open at once. Polls the live daemon getter once a second and
  re-renders on an actual tier change, so switching daemon tiers in the background updates which apps are visible
  without needing to relaunch `ui.app.js`.
- `ui/components/status-panel.tsx` — small floating status line (the live daemon tier, same live-polling treatment
  as `app-grid.tsx`) with Restart/Quit buttons. Both buttons only flip a flag via a `setTimeout`-deferred callback
  — real work (unmounting, the actual relaunch) never happens synchronously inside a React event handler, which
  races React's own reconciliation and throws.
- `ui/components/overview-stats.ts` — writes into the game's own `#overview-extra-hook-0` cell, subscribed to
  `cgd.store` (see the daemon section) rather than computing anything itself or being driven by a loop. Plain DOM
  (`doc.createElement`), not React — stays `.ts`; subscribing to an external store already gets "only re-render
  when the data actually changes" without needing a JSX rewrite, and `assets/overview.ts`'s CSS depends on this
  cell's exact DOM structure (see that file's own notes), which staying plain DOM avoids ever risking.
- `ui/apps/` — pluggable apps shown in the grid, registered in `ui/apps/index.ts`. Each is an
  `AppDefinition { id, icon, label, Content, minDaemonTier? }`, where `Content` is a real React function component
  (not just a render callback) specifically so it can use hooks like `useQueuedNs()`. `minDaemonTier` currently has
  no real consumer (see the daemon section's tier table) but is live, tested infrastructure for whatever capability
  ends up genuinely dispatch-based at some tier in the future.
- Styling is plain CSS, not inline `style` objects: every app applies the `.bb-*` classes from `assets/controls.ts`
  (see that file's header comment), which read the player's active in-game color theme via `--bb-theme-*` CSS
  custom properties (with hardcoded fallbacks) so this UI matches whatever theme — including a player-imported
  one — is active. `ui/utils/theme.ts` no longer exists; only reach for an inline `style` for genuinely one-off,
  non-thematic layout (`position`, `gap`, a dynamic `width: ${pct}%`, ...) that doesn't belong in shared CSS.

Any file that renders React elements uses real JSX (`.tsx`), not `React.createElement(...)` calls — see any file
under `ui/apps/` or `ui/components/` (except `overview-stats.ts`, see above) for the pattern. This works without an
actual `react` runtime dependency: `tsconfig.json` sets `"jsx": "react"` (classic transform, emits
`React.createElement(...)` textually) rather than the automatic runtime, since the automatic runtime needs a real
`react/jsx-runtime` module to import from and this project has none — React only exists as the game's `window.React`
global (see `ui/utils/react-globals.ts`). The classic transform just needs an identifier literally named `React` in
lexical scope, which is exactly what's already threaded through: a prop on every app's `Content` component
(`{ React }: AppComponentProps`), or destructured from `ReactGlobals` in `ui/components/*.tsx`. Renaming that
identifier (e.g. aliasing `React.createElement` to a shorter `e`, the old pre-JSX pattern in this codebase) breaks
JSX in that scope. `@types/react`/`@types/react-dom` are installed as devDependencies only (no runtime `react`
package) purely so `tsconfig.json`'s `"types"` array can pull in the ambient global `JSX.IntrinsicElements` — needed
for `tsc` to type-check intrinsic elements (`<div>`, `<button>`, ...) at all — without adding anything to any
script's actual RAM/bundle footprint (types are fully erased before Viteburner/esbuild emit JS). `AppComponentProps.React`/`ReactGlobals.React` stay typed `any` on purpose — tightening them to the real React types would
ripple into every component's untyped `useState`/`useEffect` call sites, which is out of scope for just enabling JSX.

**Viteburner gotcha**: its default upload-path renamer only strips a trailing `.ts` (`file.replace(/\.ts$/, ".js")`),
which — because that regex anchors on the string ending in exactly `ts` — silently does nothing to a `.tsx` file
(ends in `tsx`), deploying it in-game with its `.tsx` extension intact instead of `.js`, and baking that same broken
path into any sibling file's compiled `import`. `vite.config.ts` works around this with a custom `location` function
(regex `/\.tsx?$/`) on the `.tsx`-matching watch entry — don't drop that override. That function must return an
object (`{ filename: "..." }`), not a bare string: internally, a string return is treated as a `server` (hostname)
override instead of a filename one, which breaks uploads for every file, not just `.tsx` ones (see that override's
own comment in `vite.config.ts` for the exact mechanism).

## The `cgd` tiered daemon and `window.cgd` namespace

**The single most load-bearing architectural fact in this repo.** `ui.app.ts` doesn't keep a loop running and
doesn't call `ns.*` for anything apps need — all of that lives in a separately-running, persistent daemon reached
through `window.cgd`, the same `eval("window")` trick used to reach React/ReactDOM: every script here runs in the
same real browser window regardless of which process created a reference to it, which is what makes a *shared*
namespace across independently-running scripts possible at all. Full design record — including every course
correction, several driven by live in-game RAM measurements rather than just reasoning — lives in
`docs/epic-cgd-namespace.md`; read it before making structural changes here, this section is just the current-state
summary.

- **Shape**: `window.cgd = { daemon, store, reactApps }`. `daemon` (`src/cgd/types.ts`'s `CgdDaemon`) is present
  only while a daemon is alive *and* ready to serve (see the handoff protocol below) — its mere presence is a
  trustworthy readiness signal, not just an existence check. `store` is a long-lived, hand-rolled pub-sub
  (`getState`/`setState`/`subscribe` — no `zustand` or any other dependency, see `src/cgd/store.ts`) that survives
  every daemon replacement, since a fresh instance per daemon would silently strand an already-subscribed consumer
  holding the old reference. `reactApps` holds `ui.app.ts`'s own mounted React trees (see the previous section).
- **Tiers are a deliberate RAM/capability dial the player turns**, not an implementation detail — see
  `docs/epic-cgd-namespace.md`'s tier table for the authoritative, current list. As of this writing: tier 0 (no
  caller-facing dispatch at all, just baseline stats pushed to the store), tier 1 (core `ns.*` dispatch — an
  **explicit, enumerated allow-list**, never "everything except reserved namespaces"; ~1.6GB), tier 2 (cloud-server
  + slave-node management, as named compound actions, not raw dispatch). Tier 4 (Singularity) was planned and
  explicitly decided against — Trainer/Backdoor Installer stay independent, unrestricted-`ns` processes gated on
  SF4/BitNode-4, permanently, since folding a long-running loop into a tier would make every daemon at that tier
  pay its RAM cost forever, not just while actually in use. `daemons/lv0/lv1/lv2.daemon.ts` form a strict
  one-directional import chain (`lv1 ← lv2 ← ...`, see `docs/epic-cgd-namespace.md`'s import-chain section) — a
  lower tier must never statically reference a higher tier's capability.
- **Two ways an app reaches the daemon**, both via context hooks, never `window.cgd` directly:
  `useQueuedNs()` → a raw single-`ns.*`-method forward (`cgd/dispatch.ts`'s `dispatchCall`, genuinely computed
  dispatch — see the RAM-cost model section above for why that matters and what it does *not* buy you), and
  `useCgdActions()` → a named, tier-registered "compound action" (`cgd/types.ts`'s `CgdActionHandler`) for anything
  needing more than one `ns.*` call as a single atomic step (a network BFS in `cgd/actions/slave-nodes.ts`; a
  fetch-then-self-heal-a-config-file in `cgd/actions/cloud.ts`). Compound actions don't need the `_`-prefix
  treatment — their literal `ns.*` calls live directly in the handler body and get counted the ordinary way just
  by the function being defined, with no decoy/allow-list sync required.
- **Startup/handoff protocol** (`cgd/daemon-core.ts`'s `runTieredDaemon`, shared by every tier): on start, a
  daemon asks whatever's currently registered in `cgd.daemon` to stop (`_stop()`, which rejects everything pending
  on its queue and clears `cgd.daemon` via its own `ns.atExit`), polls until that's actually gone, then registers
  itself — this is the *same* mechanism whether the incoming daemon is a different tier or a redeploy-and-relaunch
  of the tier that's already running. `cgd.daemon` is only assigned once the drain loop is genuinely ready.
- **Self-healing across a background daemon swap or replacement**: the queue, the action dispatcher, app-grid
  visibility, and the status panel's tier display all resolve against whichever daemon is *currently* registered
  — a live getter (`() => cgd.daemon`), re-checked on every call (queue/actions) or every second (grid/status
  panel polling `_getTier()`) — never a reference or tier value snapshotted once at `ui.app.ts` mount time. This
  was found the hard way: a fixed reference kept pointing at a since-replaced daemon's dead queue, hanging forever
  (not even erroring) instead of resolving.
- `src/start.ts` is the idempotent bootstrap script — `run start.js [tier] [remote]`: auto-picks the highest tier
  `home` can afford (`min(home's max − 5GB, home's max × 0.8)` usable ceiling, reusing the same headroom
  convention `ramShortfallReason` already applies to apps) unless a specific tier/remote is given, waits for the
  daemon to actually register (`ns.exec` returns before a launched process has finished its own setup — a real
  race, not hypothetical), then launches `assets.app.js`/`ui.app.js`. Kept deliberately RAM-thin: only RAM
  arithmetic + `getScriptRam`/`exec`/`hasRootAccess`/`scp` — never a daemon-tier module import, which would
  permanently bake that tier's RAM cost into `start.js` itself.

## `assets.app.ts` — custom CSS injector

Unrelated one-shot script (not React): injects this project's own CSS into the live game window. Creates/reuses a
`<style id="custom-styles">` element in `<head>` and fills it from the chunks in `src/assets/` (listed in
`assets/index.ts`). Existing chunks: `ui-scale.ts` (global `zoom` to shrink/grow the whole game UI — `zoom`, not
`font-size` or `transform: scale`, because most of the game's own layout is fixed-px, and only `zoom` actually
reflows to reclaim the freed space), `overview.ts` (restyles the game's default character-overview table, which has
no id/class of its own — scoped via `table:has(#overview-hp-hook)` instead, and per-stat XP bar colors are matched
by fixed row position since CSS has no "previous sibling" selector to look back at a labeled row from its bar row),
`scrollbar.ts` (thin theme-colored scrollbars, scoped to the app grid/floating windows only), and `controls.ts` (the
`.bb-btn`/`.bb-field`/`.bb-card`/`.bb-progress`/... classes every app under `ui/apps/` and `ui/components/` uses
instead of computing its own inline `style` object — see that file's own header comment for the full class list).
Safe to re-run any time (e.g. after editing a style chunk) — nothing needs to keep running afterward, since a
`<style>` element lives in the DOM independent of any script's process. `start.ts` (see the daemon section above)
launches this as part of its normal bootstrap, so a player rarely needs to run it by hand.

**All app-visible notifications/toasts must go through Bitburner's own `ns.toast(msg, variant, duration)`** — via
`ui/utils/notify.ts`'s `notifySuccess`/`notifyError` helpers — rather than a hand-rolled self-dismissing banner or a
vendored third-party toast library. `file-explorer.tsx`'s post-action toasts (e.g. after Copy to) are the example to
follow. `ns.toast` is a real `ns.*` call (0 GB RAM cost, but still subject to the same-script overlap rule), so
`notify.ts`'s helpers take the queued `ns` proxy as a parameter and must be called from code that already has one —
never call them with a raw `ns` — and, like every other queued call, go through `_toast(...)`, not `.toast(...)`
(see the RAM-cost model section above).

## Everything else under `src/`

The rest of `src/` — the top-level `*.app.ts` (application scripts), `*.lib.ts` (shared helpers),
`init.ts`/`map.ts`/`servers.ts` (functional scripts), `src/daemons/` (every `*.daemon.ts`), and `src/contracts/`
(one file per coding-contract solver) — is the original project this repo was built from, plus the tiered daemon
described above. `src/daemons/` mixes two genuinely different kinds of file, easy to conflate:

- **Worker payloads / genuinely independent processes**, meant to keep running regardless of what the UI does:
  `hack`/`grow`/`weaken`/`share.daemon.ts` (generic loops, launched with args by whichever app needs them),
  `xp-farm.daemon.ts` (self-managing orchestrator — deliberately *not* folded into the tiered daemon; see
  `docs/epic-cgd-namespace.md`'s "Daemon classification" table for why that would've been a regression), and
  `train.daemon.ts` (Singularity training loop, SF4/BitNode-4-gated, also deliberately independent — see the
  daemon section above).
- **The tiered daemon itself**: `lv0.daemon.ts`/`lv1.daemon.ts`/`lv2.daemon.ts` (see the daemon section above) —
  persistent, not one-shot, and structurally different from every other file in this folder (each imports the
  daemon file of the tier below it, forming a strict chain, and none of them are ever launched with
  action-specific args the way a worker payload is).

Every daemon deploys to `daemons/<name>.daemon.js` in the game (Viteburner mirrors `src/`'s own folder structure
minus the `src/` prefix), so any `ns.exec`/`ns.run`/`ns.kill`/`ns.isRunning`/`ns.getScriptRam`/`ns.scp` call
referencing one by filename must use that `daemons/<name>.daemon.js` path, not the bare filename. `README.md`
now has its own "Sidebar UI" section covering `start.ts`/`ui.app.ts`/the tiered daemon/every app under
`ui/apps/` at a lighter, user-facing level of detail — this file and `docs/epic-cgd-namespace.md` stay the
deeper, implementation-level reference.
