import { NS } from "@ns";
import { createCgdQueue } from "./queue";
import { ensureCgdStore } from "./store";
import { CgdActionHandlers, CgdDaemon, CgdStore, CgdTier, CGD_SCHEMA_VERSION } from "./types";
import { getCgd } from "./window-cgd";

const HANDOFF_POLL_MS = 100;
const HANDOFF_TIMEOUT_MS = 5000;
const IDLE_SLEEP_MS = 100;

/**
 * The tier-agnostic engine every `daemons/lv*.daemon.ts` runs: hands off
 * from whatever daemon (if any) is currently registered, registers itself
 * once ready, then loops draining its own queue until told to stop. See
 * `docs/epic-cgd-namespace.md`'s "Startup / handoff protocol" section for
 * the design this implements.
 *
 * Deliberately holds no tier-specific capability of its own — a tier's
 * *actual* handler/stat code, and its dispatchable surface (`allowedPaths`,
 * each entry backed by a literal decoy reference in that tier's own file —
 * see `dispatch.ts`'s `isPathAllowed`), lives in that tier's own
 * `lv*.daemon.ts` file, not here. This file's own literal calls (`ps`,
 * `atExit`, `sleep`) are free (0 GB) or already unavoidable for any running
 * script, so it's safe to import unchanged from every tier without adding
 * to any of their RAM budgets on its own.
 *
 * `options.onIdle`, if given, runs once per idle tick (queue empty),
 * receiving the already-ensured `cgd.store` (see `ensureCgdStore` below) —
 * the same "productive use of the time it'd otherwise spend just sleeping"
 * slot `ui.app.ts`'s old main loop used for its stat/RAM refresh, before
 * this epic. Each tier's own `lv*.daemon.ts` passes in whatever stat-push
 * behavior belongs at that tier (see `cgd/stat-push.ts`) — throttling
 * internally however makes sense for its own providers, the same way the
 * old `overview-stats.ts`/`home-ram-poller.ts` throttled themselves.
 *
 * `options.actionHandlers`, if given, is passed straight through to
 * `createCgdQueue` — see `cgd/types.ts`'s `CgdActionHandler` for what these
 * are and why tier 2+ needs them alongside raw single-method dispatch.
 *
 * Both live on one options object (rather than two more positional
 * parameters) since this function's optional knobs are only going to grow
 * as more tiers land, and positional optionals get harder to read at each
 * call site the more of them there are.
 */
export interface TieredDaemonOptions {
    actionHandlers?: CgdActionHandlers;
    onIdle?: (ns: NS, store: CgdStore) => void | Promise<void>;
}

export async function runTieredDaemon(
    ns: NS,
    tier: CgdTier,
    selfScript: string,
    allowedPaths: ReadonlySet<string>,
    options: TieredDaemonOptions = {}
): Promise<void> {
    const { actionHandlers = {}, onIdle } = options;
    ns.disableLog("ALL");

    const win = eval("window");
    const cgd = getCgd(win);

    // Hand off from whatever's currently registered, if anything — this
    // runs unconditionally, whether the currently-registered daemon is a
    // different tier (a deliberate tier switch) or literally another
    // instance of this exact script (e.g. redeploying after an edit and
    // relaunching the same tier) — both are "something's already serving
    // cgd.daemon, ask it to stop and take its place," the same mechanism
    // either way. Ask it to stop, then poll cgd.daemon until it's actually
    // gone (not a fixed sleep) rather than assuming a fixed delay is always
    // enough.
    const existing = cgd.daemon;
    if (existing) {
        existing._stop();
        const start = Date.now();
        while (cgd.daemon && Date.now() - start < HANDOFF_TIMEOUT_MS) {
            await new Promise((resolve) => setTimeout(resolve, HANDOFF_POLL_MS));
        }
        if (cgd.daemon) {
            ns.tprint(
                `WARNING: ${selfScript} — previous daemon (tier ${cgd.daemon.tier}) didn't clear cgd.daemon within ${HANDOFF_TIMEOUT_MS}ms; taking over anyway.`
            );
        }
    }

    // Refuse only if a duplicate of this exact script is STILL running at
    // this point — the handoff above already gave a same-tier predecessor
    // every chance to exit cleanly (its own atExit clears cgd.daemon right
    // as its process ends), so a genuine leftover here means something
    // didn't clean up properly (or two instances were started in a genuine
    // race), worth surfacing rather than silently racing over the same
    // cgd.daemon slot. Checking this AFTER the handoff, not before, is what
    // lets "relaunch the tier that's already running" work at all — it used
    // to run first and unconditionally refuse, which meant redeploying and
    // relaunching the *same* tier required manually killing the old pid
    // first, unlike switching to a different tier.
    const others = ns.ps("home").filter((p) => p.filename === selfScript && p.pid !== ns.pid);
    if (others.length > 0) {
        ns.tprint(
            `WARNING: ${selfScript} is already running (pid ${others[0].pid}) — not starting a second instance.`
        );
        return;
    }

    // Lazily creates cgd.store if this is the first daemon (of any tier,
    // ever, this session) to find it missing — see store.ts's own header
    // comment for why every daemon shares the one instance rather than
    // each creating its own.
    const store = ensureCgdStore(cgd);

    const queue = createCgdQueue(tier, allowedPaths, actionHandlers);
    const state = { running: true };

    const daemon: CgdDaemon = {
        version: CGD_SCHEMA_VERSION,
        tier,
        queue,
        _getTier: () => tier,
        _stop: () => {
            state.running = false;
        },
    };

    // The one guaranteed cleanup path — fires no matter how this process
    // ends (falls off the loop below, killed, throws). Rejects anything
    // still queued so a caller mid-await on a now-dead daemon gets a real
    // rejection instead of hanging forever, then clears cgd.daemon — but
    // only if it's still literally *this* daemon registered there, so a
    // late-firing atExit can't stomp a newer daemon that already took over
    // (e.g. this one was killed mid-handoff-wait by someone else).
    ns.atExit(() => {
        queue.rejectAll(new Error(`${selfScript} (tier ${tier}) stopped.`));
        if (cgd.daemon === daemon) {
            cgd.daemon = undefined;
        }
    }, "cgd-daemon-cleanup");

    // Only assigned once fully ready to drain — see the design doc's note
    // on cgd.daemon's presence being a trustworthy readiness signal, not
    // just an existence one.
    cgd.daemon = daemon;

    while (state.running) {
        try {
            const ranTask = await queue.drain(ns);
            if (!ranTask) {
                if (onIdle) await onIdle(ns, store);
                await ns.sleep(IDLE_SLEEP_MS);
            }
        } catch (err) {
            // queue.drain already catches anything a queued call itself
            // throws (see queue.ts) — this is a backstop for everything
            // else in this loop (onIdle, ns.sleep), so a single bad tick
            // can't take the whole daemon down. An uncaught throw here
            // would escape main() entirely and kill this process — which,
            // via ns.atExit below, would clear cgd.daemon out from under
            // every caller with a task still pending, instead of just this
            // one tick failing.
            ns.tprint(`WARNING: ${selfScript} (tier ${tier}) — idle-loop error, continuing: ${String(err)}`);
        }
    }
    // No cleanup code needed here — the ns.atExit callback registered above
    // fires automatically the moment this function returns.
}
