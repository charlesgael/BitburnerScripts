# Epic: `window.cgd` namespace, tiered daemon, loop-free `ui.app`

Design record for the planning conversation that produced it. Nothing in this epic is implemented yet — this is
the agreed plan to execute against. Written after two validating spikes (see "Validated assumptions" below); every
open question raised during design was resolved and is captured inline rather than left as a TODO.

## Goals

- Stop `ui.app.js` from needing to keep a `while` loop running just to drain its own `ns` call queue and refresh
  stats — mount its React UI once and exit, the same way `assets.app.ts` already injects CSS once and exits.
- Move all `ns.*` access behind a single persistent daemon process, so `ui.app.ts`'s own reachable code can shrink
  back toward the ~1.6 GB base-script-overhead floor instead of accumulating every app's RAM cost permanently.
- Make that daemon's RAM cost a **deliberate, player-visible dial** (tiers) rather than a fixed cost paid whether
  or not the extra capability is ever used.
- Let state (the `ns` call queue, live stats) live somewhere any script can reach, independent of which script
  process created it.

## Validated assumptions

Two things this whole design depends on were tested empirically before committing to it, not assumed:

1. **Cross-script closures work, including after the originating script's process has exited.** A script attached
   a plain function to `(eval("window")).cgd`; a second script, run afterward, called it successfully. This is
   what makes "the daemon owns the queue in `window.cgd`, other scripts enqueue into it" — and "a new `ui.app.js`
   calls the *previous* `ui.app.js` instance's stored unmount function" — both sound, not speculative.
2. **Bitburner's RAM analyzer is exact-identifier-text matching, not real resolution.** A local function named
   `_isBusy` was not flagged as `ns.singularity.isBusy`, confirming the mechanism `ns-queue.ts` already worked
   around once (renaming `run`→`enqueue` to dodge a false-positive `ns.run` charge). **Convention for this epic:**
   prefix anything attached to `window.cgd` with `_` (e.g. `_getTier`, `_stop`) as cheap insurance against a future
   `ns.*` addition colliding with one of these names.

3. **Correction, found during phase 2 live testing — computed dispatch is not actually free.** The original version
   of this section (and `cgd/dispatch.ts`) assumed a computed property access (`receiver[method](...)`, no literal
   `.methodName(` text) permanently evades RAM accounting, since the static analyzer that decides a script's launch
   allocation is text-based. That's only half true: Bitburner **also** tracks, at runtime, every distinct `ns.*`
   function actually invoked — including through computed access — and kills the script outright ("RAM USAGE
   ERROR... you somehow circumvented the static RAM calculation") the moment that live usage exceeds what was
   reserved at launch. So dynamic dispatch doesn't make a call free; it just makes it invisible to the static
   allocation, which then crashes the whole daemon the first time something under-provisioned actually runs — this
   happened for real, live, the first time the Restart button exercised `queuedNs.run(...)` (a call that had never
   been referenced anywhere in `lv1.daemon.js`'s own reachable text — since fixed by using `exec` with an explicit
   host instead, which was already on tier 1's list for other reasons, rather than adding `run` as its own entry).
   The fix (already implemented): each tier's
   dispatchable surface is now an **explicit, enumerated allow-list** (`cgd/dispatch.ts`'s `isPathAllowed`, backed
   by each tier's own literal, `void`'d decoy references — see `lv1.daemon.ts`'s `TIER_1_METHODS`/`reserveTier1Ram`),
   not the "policy, not RAM — everything except reserved namespaces" model this section originally described.

   Also found in the process: a bare, unprefixed identifier reference (no `ns.` needed, not even a call) is enough
   to be counted by the static analyzer — confirmed by testing a decoy of bare names before settling on the safer,
   type-checked `void ns.someMethod;` form actually implemented.

   **Consequence for the tier-cost model**: a tier's dispatchable surface is no longer "everything not explicitly
   reserved for a higher tier, at no extra cost" — it's a specific, finite, RAM-accounted list, exactly like
   `cgd/stats.ts`'s provider list already was. Tier 1 currently allows exactly the ~13 methods from the original
   RAM breakdown plus `run` — closed and minimal, grown one method at a time as apps get migrated onto the daemon
   queue (phase 3), rather than pre-populated with a broad guess at "general NS surface," which would have
   materially inflated tier 1's real cost.

4. **Found live, during phase 4 testing — a snapshotted daemon reference hangs forever across a background tier
   switch, silently.** `ui.app.ts` originally built `queuedNs`/the actions dispatcher once at mount time, bound to
   whichever daemon was registered *then* (`createQueuedNs(daemon.queue)`). Sequence that broke it: start `lv2`,
   mount `ui.app.js` (binds to `lv2`'s queue), start `lv1` (handoff stops `lv2`, `lv1` takes over `cgd.daemon`),
   click Restart. The UI unmounted fine, but the relaunch call itself enqueued into `lv2`'s now-dead queue —
   `lv2`'s own `_stop()`/`atExit` had already rejected everything pending *at that moment*, but nothing was left to
   drain anything enqueued *afterward*, so the promise just never resolved or rejected. No error, no `console.error`
   — because nothing ever threw; the `await` just hung forever.

   Fix: `ns-proxy.ts`'s `createQueuedNs` and `app-grid.tsx`'s action dispatcher both take a **live getter**
   (`() => cgd.daemon`) instead of a fixed reference now, re-resolved on every single call — a background daemon
   swap self-heals automatically, and a call made while no daemon is registered at all rejects immediately instead
   of hanging. Originally scoped to *functional* calls only, leaving `AppDefinition.minDaemonTier` gating (a tier
   snapshotted once at mount, same as `minSourceFile`/`ownedSF`/`currentNode`) as a known follow-up — closed
   shortly after, once it actually surfaced live: switching tier 0 → 1 in the background left the grid empty
   forever without a relaunch. `app-grid.tsx` now polls `getDaemon()?._getTier()` every second (the same live
   getter, plain `setInterval`, no new `ns` cost) and re-renders on change; `ownedSF`/`currentNode` moved from a
   one-shot fetch in `ui.app.ts` into `app-grid.tsx`'s own `fetchResetInfoIfNeeded`, retried on every tier change
   so a grid created at tier 0 (which skips that fetch entirely, since tier 0 would reject it) picks it up as soon
   as a real tier takes over. `createAppGrid`'s `setResetInfo` method is gone — this is now fully internal.
   `status-panel.tsx`'s tier line got the identical treatment right after — it also used to be a fixed string
   `ui.app.ts` rendered once at mount, same staleness bug, same fix (its own `getDaemon` poll).

5. **Found live, while investigating why `ui.app.js` still measured 9.25GB instead of its ~1.6GB target — the
   identifier-collision false positive is broader than "literal call syntax."** §2/§3 above already established
   that a literal `.methodName(` call gets billed regardless of the receiver's real type (`run-daemon.ts`'s
   `QueuedNS`-typed `ns.exec(...)`, etc.) — but `ui.app.js`'s cost included a mysterious `2.40GB | share` line with
   **no `.share(` call anywhere in its reachable import graph**. The actual culprit:
   `ui/apps/share/components/share-content.tsx` had `const share = useShare(React);`, then referenced that
   variable's own unrelated properties throughout (`share.refresh()`, `share.loading`, `share.hosts`, ...). None of
   those are calls *named* `share` — but the bare identifier `share` appearing as a variable declaration was enough
   to trigger the charge on its own. So the real rule is: **the analyzer flags any identifier token that lexically
   matches a real `ns.*` function name, in any syntactic role at all** — a call, a property access, or a bare local
   variable declaration/reference with nothing to do with `ns`. Renaming the variable (`shareState`) removed the
   charge entirely. This is the same root cause as `ns-queue.ts`'s original `run`→`enqueue` rename, just triggered
   by a declaration this time instead of a call — worth grepping for elsewhere in `ui/`/`cgd/` (short, common `ns.*`
   names — `run`, `read`, `write`, `scan`, `hack`, `grow`, `weaken`, `sleep`, `exec`, `kill`, `ps`, `ls`, `mv`, `rm`,
   `scp`, `share`, `tail`, `connect` — are the highest-risk collision candidates for a local variable name) if a
   script's measured RAM ever doesn't match what its actual `ns.*` usage should cost. (`args` also turned up in this
   sweep as a local variable name in `use-task-manager.ts` — left alone: `ns.args` is a plain data field, not a
   function, so it has no RAM-cost-table entry to false-positive against in the first place.)

6. **The fix for §5, generalized: `QueuedNS`'s entire surface is now `_`-prefixed.** §5 found one instance (a
   local variable named `share`); the same underlying mechanism (§2/§3's literal-identifier-text matching) was
   actually leaking through *every* app file that wrote ordinary `queuedNs.exec(...)`/`.kill(...)`/etc. calls —
   `use-trainer.ts`, `use-task-manager.ts`, `use-file-explorer.ts`, `use-share-host-card.ts`, `use-xp-farm.ts`,
   `remote-file-bounce.ts`, `run-daemon.ts`, `slave-nodes.ts`, `xp-farm-config.ts`, `network-hosts.ts`,
   `notify.ts`, `hello-world-content.tsx` — each one, despite genuinely calling through the free computed-dispatch
   proxy at runtime, was billing its literal call text to whatever script imported it. This had been quietly true
   since before this epic even started (most of these methods were already part of `ui.app.js`'s pre-epic cost —
   see the original RAM breakdown at the top of this doc) — nobody had previously traced *why*.
   `ui/utils/ns-proxy.ts`'s `QueuedNS` type and Proxy were reworked so **every** exposed property is `_`-prefixed
   (`queuedNs._exec(...)`, `queuedNs._hacknet._numHashes()`, ...) — the Proxy strips the leading `_` before
   building the real dispatch path, so calls still resolve correctly, but the literal text callers write no longer
   lexically matches any real `ns.*` name. `QueuedNS`'s type only exposes the prefixed names (no non-prefixed
   escape hatch), so every call site across every app needed updating — TypeScript's own compiler errors were used
   as the exhaustive checklist. Two files (`use-file-explorer.ts`, `use-share-host-card.ts`) had typed their `ns`
   parameter as `any`, so the compiler couldn't see their calls at all — both got tightened to `QueuedNS` as part
   of this fix, both to catch their own leaks and so this class of bug gets caught automatically going forward.
   Net effect on `ui.app.js`'s measured cost: 9.25GB → 2.60GB confirmed live (1.60GB base + `getResetInfo`'s
   1.00GB, `ui.app.ts`'s one remaining literal call at that point) → **1.60GB**, its actual base-overhead floor,
   once that last call was also switched to go through the queue (`await queuedNs._getResetInfo()`) instead of
   the raw `ns` — there was never a functional reason for it to be direct, just convenience from when it was
   written; `getResetInfo` was already on tier 1's allow-list, so routing it costs nothing extra, just one more
   queue round-trip during mount. Down from the ~7.8GB `ui.app.js` measured at the very start of this epic, before
   any of this work began. This also resolved a real blocking problem it happened to surface: `ui.app.js`'s reservation
   doesn't outlive its own near-instant mount, but it does have to coexist with an already-running daemon's
   reservation for that instant — at the pre-fix 9.25GB, `ui.app.js` + even the cheapest daemon (tier 0, 3.40GB)
   added up to 10.25GB, more than an 8GB starter home has at all, meaning a starter player couldn't launch the UI
   once any daemon was running. Post-fix, that combination fits comfortably.

## 1. The `window.cgd` namespace

```
window.cgd = {
    daemon: {          // present iff a daemon is currently alive and ready to serve; absent (undefined/deleted)
        version: ...,   // schema version tag — see "Versioning" below
        tier: 0|1|2|4,
        queue: NsQueue,  // relocated ns-queue.ts, unchanged shape
        _getTier(): tier,
        _stop(): void,   // rejects every pending queue entry, then clears window.cgd.daemon
    },
    store: CgdStore,   // stable, long-lived — see "Store lifecycle" below. NOT created/owned by any one daemon.
    reactApps: {
        launcher,       // app-grid: icon grid + floating windows
        overview,       // new React rewrite of the overview-stats panel
        status,         // status-panel
    },
}
```

- `window.cgd` is reached the same way `react-globals.ts` already reaches React/ReactDOM: `eval("window")`. This
  is the real browser `window`, shared identically across every script's process — not a per-script copy.
- Everything under `cgd` is wiped by a full page reload (browser refresh, or whatever an augmentation
  install/BitNode reset does internally) — expected and fine, `start.ts` rebuilds it from scratch afterward. No
  script needs to treat that as an error case to design around specially.
- Viteburner's hot-sync only copies new source into the game — it does **not** restart anything. The player still
  manually relaunches `ui.app.js`/the daemon after an edit, same as today.

### Versioning

`cgd.daemon.version` (and, if it turns out to matter in practice, a version on `cgd.store`/`cgd.reactApps` too) —
a simple tag a consumer checks before trusting the shape it finds, so a stale-build daemon sitting in memory next
to a freshly-redeployed `ui.app.ts` fails loudly instead of reading a renamed/missing field as `undefined`.

## 2. The tiered daemon

### Tiers and capability boundaries

| Tier | Capability | Notes |
|---|---|---|
| 0 | No caller-facing methods at all (empty queue-dispatch surface) | Still runs its own internal stat-pulling loop and pushes into the store — "no methods" refers only to what other scripts can route through its queue, not to what it does for itself. |
| 1 | ✅ Implemented — `TIER_1_METHODS` in `lv1.daemon.ts`: `exec`, `kill`, `scp`, `rm`, `ls`, `isRunning`, `fileExists`, `getScriptRam`, `getResetInfo`, `getPlayer`, `hacknet.numNodes`, `hacknet.getNodeStats`, `ps`, `ui.openTail`, `read`, `write`, `mv`, `getServerUsedRam`, `getHostname` (+ the 1.6 GB base overhead every script pays regardless) | The baseline "real" tier. Grew beyond just what `ui.app.js` used to pay for directly once phase 2's `ns-proxy.ts` rewire meant every app's own `queuedNs.*` call sites route through this same allow-list immediately (not only calls this epic deliberately migrates in phase 3) — the extra six entries came from auditing every `ui/apps/**` file's actual call sites rather than discovering each one reactively as a "not available" error. `ui.app.ts`'s restart button uses `exec` with an explicit host rather than `run` (`ns.run` is just `ns.exec` with the host implied), so no separate entry was needed for it despite `run` briefly being added and then removed — see "Validated assumptions" §3. An **explicit, enumerated allow-list**, each entry backed by a literal decoy reference in `lv1.daemon.ts` — see §3 for why this isn't just "everything not reserved for a higher tier" the way this table originally described it. |
| 2 | ✅ Implemented — `lv2.daemon.ts`'s actions: `cloudList`/`cloudBuy`/`cloudDelete` (`ns.cloud.*`), `slaveNodeHosts` (network scan) | Absorbs `cloud-list`/`cloud-buy`/`cloud-delete`/`slave-node-hosts.daemon.ts` (all deleted) as compound actions (see `cgd/types.ts`'s `CgdActionHandler`), not raw dispatch — genuine multi-step operations. `cloudList` is here despite being read-only: tried at tier 1 first (several other apps depend on it), but measured live at 11.55 GB total for tier 1 once `getServer`/`cloud.getServerNames` were pulled in — too heavy for tier 1's ~8 GB starter-player budget, so it moved here instead. XP Farm's orchestrator (`daemons/xp-farm.daemon.ts`) stays independent, NOT absorbed here — see the "Daemon classification" table's note on why folding its loop into every tier-2 daemon's `onIdle` would cost non-farming players RAM for nothing. |
| 3 | **Real file, empty passthrough for now.** No capability of its own yet (candidates for later: stock market, corporation, gang, bladeburner, sleeve) — imports and re-exports tier 2's methods and stats unchanged. Exists today purely to hold the number's place in the chain. | |
| 4 | **❌ Not built — decided against.** `ns.singularity.*` was the plan, but both existing consumers (`train.daemon.ts`, `backdoor.app.ts`) turned out to be long-running independent loops (fixed ~88GB-without-SF4-discount RAM cost apiece), not one-shot dispatch-appropriate operations — folding either in would mean every tier-4 daemon permanently carries that cost whether or not the player is training/backdooring right now, the same regression avoided for XP Farm. Both stay exactly as they are: independent spawned processes, gated by `singularityAvailable`/`ui/utils/singularity-availability.ts` (SF4-or-BitNode-4) — permanently, not as an interim state. See "Availability gating" below. |

### File structure and import chain

Separate files per tier (`daemons/lv0.daemon.ts`, `lv1.daemon.ts`, `lv2.daemon.ts`, `lv3.daemon.ts`,
`lv4.daemon.ts` — all five exist as real files), forming a **strictly linear chain**: `lv1 ← lv2 ← lv3 ← lv4` —
each tier's daemon file imports the daemon file of the tier immediately below it, not a flat multi-import of every
lower tier's handlers. `lv3.daemon.ts` today is a real, working passthrough: it imports `lv2`'s handlers and stat
providers and re-exports them unchanged, adding nothing of its own — it exists to hold tier 3's place in the chain
so `lv4.daemon.ts` imports `lv3` (which already carries `lv2`), never `lv2` directly. This is required by the
RAM-cost model: a script is charged for every `ns.*` function its whole reachable import graph references, whether
or not that path ever runs — so a lower tier must never import anything that references a higher tier's namespace
(e.g. `lv1` must never import from `lv4`), and the chain only ever flows upward.

Stat providers follow the same chain shape: each tier's stat registry is "the tier below's provider list plus this
tier's own additions" (e.g. `lv2`'s stat module spreads `lv1`'s and adds cloud/slave-count entries).

### Startup / handoff protocol

- On start, a daemon checks whether `cgd.daemon` is already registered. If so, it calls that daemon's `_stop()`
  and polls until `cgd.daemon` becomes `undefined` (not a fixed sleep) before registering itself in its place.
- `_stop()` rejects every pending queue entry, then clears `window.cgd.daemon` — implemented via `ns.atExit`, so it
  fires reliably regardless of how the process ends (falls off the end, killed manually, throws). The one case
  `ns.atExit` may not fire is a full page reload (BitNode reset/aug install) — irrelevant here, since that wipes
  `window.cgd` wholesale anyway and `start.ts` rebuilds it fresh.
- `cgd.daemon` is only assigned once the daemon is actually ready to drain its queue (not the instant the object is
  constructed), so its presence is a trustworthy readiness signal, not just an existence one. (Confirmed acceptable
  even if there's a small window otherwise — worst case a caller waits on the order of milliseconds.)
- Liveness detection is **solely** `cgd.daemon`'s presence/absence — never inferred from `cgd.store`, which is
  long-lived and persists across daemon generations regardless of whether anything is currently serving it.
- Tier 4 specifically refuses to start without SF4-or-BitNode-4 eligibility (its own internal guard, independent
  of anything the UI checks) — defense in depth against e.g. manually running `lv4.daemon.js` from the terminal.

### Default tier selection (`start.ts`)

Auto-picks the **highest tier the player currently qualifies for** (SF4/BN4 required before even attempting tier
4), subject to a RAM guard — **home only**:

```
usable ceiling on home = min(home.maxRam − 5GB, home.maxRam × 0.8)
```

i.e. whichever reserve is larger — a flat 5 GB or the existing 20%-headroom convention already used by
`ramShortfallReason` — wins, reusing that existing rule rather than inventing a new one. This leaves room for
`ui.app.js` itself plus incidental small launches. **No such guard applies when the daemon target is a cloud/slave
server** — there it's just the RAM-fit + `hasAdminRights` check described below.

### Dead-daemon / lost-host risk (resolved, no gap)

A slave node (rooted, non-purchased server) cannot be "lost" the way a purchased server can be deleted — there is
no delete mechanic for a non-purchased server, and root access is permanent once gained. The only ways a daemon on
either kind of host stops are a manual kill, a script error (both covered by `ns.atExit`), or a full BitNode
reset/aug install (covered by the wholesale `window.cgd` wipe + `start.ts` rebuild). No additional handling needed.

### Store lifecycle

`cgd.store` is created once, lazily, by whichever daemon first finds it missing, and **persists across every
subsequent daemon generation/tier swap** — it is not owned or recreated by any particular daemon instance. This
matters because a tier change doesn't necessarily coincide with a `ui.app.ts` relaunch; if the store were recreated
per-daemon, an already-mounted React component holding the old reference would silently stop seeing updates.

Because the store persists but the running tier can change, **each daemon generation replaces (not merges) the
stats slice** on takeover and every push cycle, so a stat no longer being produced (e.g. after a downgrade from
tier 4) disappears cleanly instead of going stale forever. The queue/meta portions of `cgd.daemon` are separate
from the store and follow the daemon's own lifecycle, not the store's.

### Store implementation

Hand-rolled, **zero new dependencies** (no `zustand`) — a minimal vanilla store (`getState`/`setState`/`subscribe`)
plus a small React hook built on `React.useSyncExternalStore` (the correct primitive for "subscribe to an external
store, re-render only when a selector's result changes" — avoids the tearing/timing pitfalls of hand-rolling this
with `useEffect`+`useState`). **Implementation-time check, not a design gap:** confirm the game's actual bundled
`window.React` is 18+ (the `@types/react`/`@types/react-dom` devDependencies only pin the *type* version, not the
runtime one the game ships).

### Stat rendering

The new React overview component renders **generically off whatever keys currently exist in the store**, rather
than `ui.app.ts` statically knowing each tier's full stat catalog — keeps the UI decoupled from daemon internals
and adds no RAM to `ui.app.ts` (labels are plain strings, not `ns.*` references).

## 3. `ui.app.ts` rewrite

- No more main loop, no more `ns.atExit`-based cleanup. On start: check whether `cgd.reactApps` is already
  populated; if so, call each entry's stored unmount function (validated feasible by the closure test above), then
  mount fresh instances and overwrite `cgd.reactApps` with its own (so the *next* launch can do the same to it).
- Teardown becomes explicit only — a `stop` argument that just unmounts `cgd.reactApps` if present. There is no
  longer a running process to `kill ui.app.js` to remove the sidebar; `run ui.app.js stop` is the only path.
- Anything that doesn't touch `ns` (status-panel's live clock, `mount.ts`'s `reattachIfDetached` polling) stays a
  plain `setInterval`/`setTimeout` inside the mounted React tree itself — no daemon involvement, no RAM cost.
- `HomeRamContext` moves from `appGrid.setHomeRam` (pushed by the old main loop) to reading the store — this also
  feeds `ramShortfallReason`'s app-grid RAM-gating, not just the display, so the migration ripples past the
  overview cell alone.
- The overview panel gets rewritten as a real React component (subscribing to the store) instead of hand-built DOM
  refreshed imperatively. Accepted risk: `assets/overview.ts`'s CSS targets it by DOM *position*, not id/class —
  the rewrite needs to reproduce the existing structure (or the CSS chunk updates alongside it).
- `daemons/restart.daemon.ts` is deleted — a fresh `ui.app.js` invocation can unmount-then-remount synchronously in
  one pass now, no cross-process wait needed.

## 4. `start.ts`

Idempotent — safe to rerun any time. Steps: ensure a daemon is running (see tier-selection above; skip if one
already is), run `assets.app`, run `ui.app` (itself idempotent per section 3). Takes optional `tier`/`remote`
arguments (see below) with sensible defaults so it doubles as the manual daemon-start entry point — no separate
script for that.

Its own tier/remote-selection logic stays deliberately thin: current/max RAM arithmetic, `ns.getScriptRam`, and
`ns.exec`/`ns.run` only — it must **not** import any daemon tier's handler modules directly, or their RAM cost
would become permanently baked into `start.ts` itself, defeating the point of keeping it a cheap bootstrap.

### Remote daemon placement

`start.ts` accepts an optional `remote` argument (defaults to `home`). When given, it checks the target can run the
requested tier via a RAM-fit + `hasAdminRights` check (mirroring `spawn-remote.daemon.ts`'s existing scp+exec
pattern) — no headroom guard applies off-home, that's a home-only rule.

## 5. Availability gating (apps)

- ✅ `AppAvailabilityContext` gains a `daemonTier` field (read once at `ui.app.ts` mount time via
  `cgd.daemon._getTier()`, effectively free — a plain property read, no `ns` call), provided to apps via the new
  `DaemonTierContext`/`useDaemonTier()` (`ui/context/daemon-tier-context.ts`), alongside the existing
  `homeRam`/`ownedSF`/`currentNode`.
- ✅ `AppDefinition` gains `minDaemonTier`, checked in `isAppVisible` alongside `minSourceFile`.
- **Resolved differently than originally planned**: this section originally expected `minDaemonTier: 4` to replace
  `singularityAvailable` for Trainer/Programs' Backdoor Installer once tier 4 existed, reasoning that tier is a more
  accurate signal than SF ownership (a player might own SF4 but run a lower tier to save RAM). That assumed tier 4
  would actually host their capability — it doesn't (see the tier-4 decision below): both `train.daemon.ts` and
  `backdoor.app.ts` turned out to be long-running independent loops, not one-shot dispatch-appropriate operations,
  and neither one's own UI-side code (spawn/monitor/kill) ever touches anything beyond tier 1. So
  `singularityAvailable`/`ui/utils/singularity-availability.ts` stays **permanently**, not just "until tier 4
  lands" — it remains the correct, and only, gate for both. `minDaemonTier` currently has no real consumer as a
  result — it's used by nothing today, but stays in place as working, tested infrastructure for whatever future
  capability genuinely does end up dispatch-based at some tier.

## 6. Scope boundary

This epic covers `ui.app.ts`, its sidebar-grid apps, and the daemon infrastructure only. Standalone terminal-run
scripts (`contracts.app.ts`, `hacknet.app.ts`, `netmapper.app.ts`, `flooder.app.ts`, and similar) stay untouched,
paying their own RAM independently — they exist precisely for when the player doesn't have enough RAM to run the
full UI/daemon stack, so folding them into this system would work against their purpose.

## 7. Daemon classification

What happens to every existing file under `src/daemons/`:

| File | What it is | Disposition |
|---|---|---|
| `hack`/`grow`/`weaken`/`share.daemon.ts` | Worker payloads meant to run on arbitrary remote hosts | Untouched — not a RAM-avoidance split, out of scope |
| `xp-farm.daemon.ts` | Long-running orchestrator managing remote grow/weaken loops | **✅ Untouched — kept independent, not folded into tier 2.** Originally classified as a tier-2 fold; reconsidered before implementation: it already only costs RAM while actively farming and exits itself when idle — exactly this epic's RAM goal already met on its own. Folding its loop into tier 2's `onIdle` would make every tier-2 daemon pay for `killall`/`scp`/`weakenAnalyze`/etc. permanently, even for a player who never farms XP — a regression, not an improvement. |
| `cloud-list`/`cloud-buy`/`cloud-delete`/`slave-node-hosts.daemon.ts` | One-shot request→result-file, RAM-avoidance splits of `ns.cloud.*`/`ns.scan`/`ns.getServer` | **✅ Deleted** — folded into tier 2 as compound actions (see the tier table above). |
| `spawn-remote.daemon.ts` | One-shot `ns.scp`+`ns.exec` for launching a script on a cloud/slave host | Folded into **tier 1** (core, not cloud-specific) |
| `train.daemon.ts` | RAM-avoidance split for `ns.singularity.*` | Folded into **tier 4** |
| `restart.daemon.ts` | Exists solely to restart `ui.app.js` across a process boundary | **Deleted** — superseded by section 3's mount-in-place design |

Every migrated one-shot daemon's request/response pattern (`runDaemon.ts` + a result file) is replaced by routing
the same call through the persistent tiered daemon's queue instead.

## 8. Cross-cutting decisions

- **Error UX**: a rejected queue call (daemon dead, tier too low, etc.) auto-surfaces via the existing
  `notifyError` toast helper at the queue-client layer — individual apps don't each need their own try/catch.
- **Naming convention**: `_`-prefix anything attached to `window.cgd` (see "Validated assumptions" above).
- **No new dependencies**: the store is hand-rolled, not `zustand` — keeps the dependency count at zero.

## Execution order (updated as phases land)

1. ✅ **Namespace skeleton + tier-0/1 daemon + queue relocation.** `src/cgd/{types,window-cgd,dispatch,queue,
   daemon-core}.ts`, `src/daemons/lv0.daemon.ts`, `src/daemons/lv1.daemon.ts`. Validated live in-game: `_getTier()`
   returns the right value, and starting `lv0` after `lv1` correctly hands off (`lv1` stops, `lv0` registers).

   While building the queue, found (and fixed before it shipped) that the closure-based design originally sketched
   couldn't actually enforce a tier boundary — see `queue.ts`'s header comment for why `enqueueCall(path, args)`
   (a plain descriptor, gated daemon-side) replaced it. Also found live evidence, while tracing where tier-1's RAM
   breakdown numbers actually come from, that the pre-epic `ui/utils/run-daemon.ts` was accidentally paying for
   `exec`/`isRunning`/`scp`/`kill`/`ls`/`fileExists`/`rm` despite believing those calls were free through a proxy —
   because Bitburner's RAM analyzer matches call *text*, not the receiver's real type, and that file typed its `ns`
   parameter as the proxy type but still wrote literal `.methodName(` calls. `cgd/dispatch.ts` documents this and
   is written to avoid it (genuinely computed access only).

2. ✅ **`ui.app.ts` mount-in-place rewrite, merged with the store/stats work.** These turned out not to decompose
   the way the original two-phase split assumed: the moment the main loop goes away, `HomeRamContext` and the
   overview panel have nothing left to poll `ns` against except a store the daemon pushes into — so "drop the loop"
   and "have somewhere live to read stats from" had to land together, not sequentially. Delivered as one slice:
   - `src/cgd/{store,stats,stat-push}.ts` — hand-rolled store (see "Store implementation" above), the baseline stat
     providers (relocated from the deleted `ui/stats/registry.ts`), and the throttled push loop `lv0`/`lv1` pass to
     `runTieredDaemon` as `onIdle`.
   - `ui/utils/ns-proxy.ts` adapted to call `queue.enqueueCall(path, args)` instead of building a closure — no
     change to its public `createQueuedNs`/`QueuedNS` surface, so no app-level code needed to change.
   - `ui/components/app-grid.tsx` takes the store directly and subscribes for `HomeRamContext` instead of an
     externally-pushed `setHomeRam`.
   - `ui/components/overview-stats.ts` rewritten to subscribe to the store and re-render on change — **stayed plain
     DOM, not React**: subscribing to an external store gets the same "only re-render when the data actually
     changes" behavior either way, and skipping the JSX conversion removes the markup-drift risk against
     `assets/overview.ts`'s position-based CSS entirely rather than just accepting it. Worth revisiting only if a
     concrete reason to prefer JSX here shows up later.
   - `ui.app.ts` itself: no loop, no `ns.atExit`; checks `cgd.reactApps` and dismounts before mounting; `stop`
     argument unmounts and exits; Restart/Stop button handlers defer their real work via `setTimeout(fn, 0)` (same
     "don't do real work synchronously inside a React event handler" constraint the old code respected by only
     flipping a flag) and Restart goes through `queuedNs.run("ui.app.js")` — i.e. the *daemon's* live `ns` — rather
     than the closure's own `ns`, which was captured from a `main()` call that's long since returned by the time a
     button is clicked; whether Bitburner still considers that reference live was never actually tested, so this
     doesn't rely on it.
   - `ui/utils/mount.ts` gained `startReattachGuardian` — the plain-`setInterval` replacement for the old main
     loop's `reattachIfDetached` polling, stopped as part of each mounted piece's own `unmount()`.
   - Deleted as superseded: `ui/utils/ns-queue.ts`, `ui/utils/home-ram-poller.ts`, `ui/stats/registry.ts` (moved),
     `daemons/restart.daemon.ts`.

   **Known temporary gaps, to close once `start.ts` (phase 6) lands:** `ui.app.ts` no longer auto-runs
   `assets.app.ts` (that responsibility moves to `start.ts` per section 4) — run `assets.app.js` manually once per
   session until then. `ui.app.ts` also now requires a daemon to already be registered (prints an error and exits
   otherwise) rather than starting one itself. `useAddChildPid()` is a no-op for now — the kill-on-cleanup pattern
   it served doesn't have a clean equivalent once `ui.app.ts`'s own process exits almost immediately after
   mounting (spawning now happens from React handlers firing long after that return) — low practical risk since
   every current call site spawns a short-lived one-shot daemon that exits on its own quickly regardless, and the
   call sites themselves go away once those apps migrate onto the tiered daemon's queue in phase 4.

3. ✅ **`minDaemonTier` infrastructure** — `AppDefinition.minDaemonTier`/`AppAvailabilityContext.daemonTier`,
   `isAppVisible`'s check, and the new `DaemonTierContext`/`useDaemonTier()` hook (mirrors the existing context
   pattern, wired into `app-grid.tsx` and `use-task-manager.ts`). Deliberately **not** applied to Trainer/Programs'
   Backdoor Installer — resolved permanently, not just deferred, once tier 4 was decided against (see phase 5
   below): their capability runs as an independent spawned process (unrestricted `ns`), correctly gated on
   SF4/BitNode-4 via `singularity-availability.ts`, and never will touch `cgd.daemon`. `minDaemonTier` currently
   has no real consumer as a result — see "Availability gating" section 5 above.

4. ✅ **Tier 2 daemon** (`lv2.daemon.ts`) — cloud-server list/buy/delete + slave-node network scan, all as compound
   actions (`cgd/types.ts`'s `CgdActionHandler`) rather than raw dispatch, added alongside the queue's existing
   `enqueueCall` as a new `enqueueAction` entry point (`cgd/queue.ts`, `ui/context/cgd-actions-context.ts`) — see
   the "Compound actions" note below. `xp-farm.daemon.ts` deliberately did **not** get folded in — see the Daemon
   classification table's updated note. `cloud-list`/`cloud-buy`/`cloud-delete`/`slave-node-hosts.daemon.ts`
   deleted; `ui/utils/cloud-list.ts`/`slave-nodes.ts`/`use-cloud-servers.ts` and every other `fetchCloudList`
   caller (Share, XP Farm, File Explorer, Programs) rewired onto `enqueueAction`. Cloud Servers app is now
   `minDaemonTier: 2`.

   **Compound actions — a mechanism tier 1 didn't need.** `enqueueCall`'s raw single-method forward can't express
   "run several `ns.*` calls as one atomic step" (a network BFS; fetch-then-self-heal-a-config-file), which
   `cloud-list`/`slave-node-hosts` both need. `enqueueAction(name, args)` looks up a hand-written, tier-registered
   function instead — and unlike raw dispatch, these need **no decoy/allow-list sync at all**: a handler's own body
   writes genuine literal `ns.foo(...)` calls, so the static analyzer counts them the ordinary way just by the
   function being defined, and looking one up by name (`actionHandlers[name]`) isn't itself an `ns.*` call, so it's
   never trackable as "dynamic usage" the way raw dispatch's computed access is.

   **Course correction, found via live measurement, not reasoning:** `cloudList` (read-only) was initially placed
   at tier 1 on the theory that foundational plumbing several apps depend on (Share/XP Farm/File Explorer/Programs)
   shouldn't be tier-2-gated. Measured live, tier 1 came out to **11.55 GB** — `getServer` (2.00 GB) and
   `cloud.getServerNames` (1.05 GB) alone blew well past tier 1's intended ~8 GB starter-player ceiling. Moved to
   tier 2 instead, alongside `cloudBuy`/`cloudDelete` (which already needed `cloud.*` there); tier 1 dropped back
   to its original ~7.95 GB. The apps that leaned on tier-1 cloud listing now degrade gracefully below tier 2
   (empty/unavailable list) instead — Programs specifically is slated for a follow-up to conditionally offer cloud
   spawn targets only once tier 2 actually becomes available, rather than everyone paying tier 1's cost for it.

5. ✅ **Tier 4 — decided against, not built.** `train.daemon.ts` and `backdoor.app.ts` were the two candidates;
   both turned out to be long-running independent loops (see the tier table's tier-4 row for the full reasoning),
   not one-shot dispatch-appropriate operations. Both stay exactly as they are today — independent spawned
   processes gated by `singularity-availability.ts` — permanently. Neither `lv3.daemon.ts` nor `lv4.daemon.ts`
   exist as files — only `lv0`/`lv1`/`lv2` were ever actually built (the design doc's section 2 describes `lv3` as
   a real, if empty, passthrough file, but nothing has needed tier 3's slot yet, and tier 4 above it is now
   unbuilt too) — nothing in this epic currently needs either. Build them if a real tier 3 or tier 4 capability
   (stock market, corporation, gang, bladeburner, sleeve, or some future singularity action that actually fits the
   dispatch/action model) ever comes up.
6. ✅ **`start.ts`** — idempotent bootstrap: ensures a daemon is running (auto-picks the highest of
   `AVAILABLE_TIERS` — currently `[2, 1, 0]`, since `lv3`/`lv4` were never built — that fits `home`'s usable
   ceiling; an explicit `tier`/`remote` argument overrides auto-selection and only actually (re)starts anything if
   what's requested differs from what's already running), then runs `assets.app.js` and `ui.app.js`. Kept
   RAM-thin per the design — no daemon-tier module imports, just RAM arithmetic + `getScriptRam`/`exec`/
   `hasRootAccess`/`scp`.

   **Found while implementing, not anticipated in the design**: `ns.exec` starts a process asynchronously, so
   launching the daemon and immediately launching `ui.app.js` right after would frequently lose a race —
   `ui.app.js` checks for a live `cgd.daemon` at its own startup, and the just-launched daemon's own setup
   (especially a handoff replacing a previous daemon) isn't necessarily done yet by the time the next line runs.
   `start.ts` now polls `cgd.daemon?._getTier()` (plain property reads, no `ns` cost) until it matches the tier
   just launched, capped at a timeout, before moving on to `assets.app.js`/`ui.app.js` — same polling shape as
   the daemon's own handoff-wait in `cgd/daemon-core.ts`.

7. ✅ **Remaining cleanup.** The last `runDaemon.ts` consumer was `ui/utils/spawn-remote.ts` (backing Programs'
   cloud-server dropdown and Share's cloud-host cards) — its one-shot `daemons/spawn-remote.daemon.ts` did nothing
   `scp`/`exec` couldn't already do as two direct tier-1 dispatch calls (no atomicity need between them here), so
   it was rewritten to call `ns._scp`/`ns._exec` directly instead of spawning a separate script. That made
   `daemons/spawn-remote.daemon.ts` and `ui/utils/run-daemon.ts` (`runDaemon` itself) both fully dead — deleted.
   `addChildPid`, now unused in both callers (`use-task-manager.ts`, `use-share-host-card.ts`) since there's no
   longer a launcher-daemon pid to track, separately from the launched script's own pid, cleaned up too. Stale
   `daemons/spawn-remote.daemon.ts` mentions in `share/index.ts`/`task-manager/index.ts` fixed. Trainer/Programs'
   Backdoor Installer remain permanently excluded from all of this — see phase 5.
