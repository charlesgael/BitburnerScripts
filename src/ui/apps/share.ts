import { AppComponentProps, AppDefinition } from "../types";
import { useQueuedNs } from "../context/ns-queue-context";
import { useAddChildPid } from "../context/child-pids-context";
import { useHomeRam } from "../context/home-ram-context";
import { theme, wrapText } from "../utils/theme";

/**
 * Lets the player dedicate some of `home`'s free RAM to `ns.share()`,
 * boosting reputation gain from faction work while it runs.
 *
 * This app never calls ns.share() itself — see `daemons/share.daemon.ts`'s header
 * comment for why (2.4GB, permanent on ui.app.js if referenced here).
 * exec/kill/isRunning/ps/getScriptRam are all already part of ui.app.js's
 * footprint via the Trainer/Programs/Cloud Servers apps, so using them
 * here is free. `home`'s used/max RAM itself comes from `useHomeRam()`
 * (see `ui/context/home-ram-context.ts`) rather than this app polling
 * ns.getServerUsedRam/getServerMaxRam on its own timer — the main loop
 * already refreshes that on a schedule for every app at once.
 *
 * Each thread of daemons/share.daemon.js costs a fixed 4GB (1.6GB base + 2.4GB for
 * ns.share()), so "how much RAM to give" and "how many threads to launch
 * with" are really the same picker. Rather than a freeform number input,
 * the amount is chosen from a `<select>` of thread-count tiers so only
 * amounts that actually fit in free RAM are ever selectable — the same idea
 * as the RAM-tier picker in the Cloud Servers app, but generated instead of
 * a fixed tier list since thread counts (unlike purchasable server sizes)
 * aren't bounded to a small fixed set. Pure doubling (1, 2, 4, 8, 16, ...)
 * was tried first but skips perfectly reasonable in-between amounts — e.g.
 * 3 threads (12GB, a fine amount to donate to sharing) sits between the 2
 * and 4 tiers and was never offered — so each doubling is split with its
 * midpoint (1, 2, 3, 4, 6, 8, 12, 16, 24, 32, ...) instead: still a short
 * list, but one that lands on "nice" numbers roughly every 50% step rather
 * than every 100% one. When not even one thread fits, the select and Start
 * button are skipped entirely in favor of a plain explanation of why —
 * there'd be nothing useful to interact with otherwise.
 */
const DAEMON_SCRIPT = "daemons/share.daemon.js";
const DAEMON_HOST = "home";

/** 1, 2, 3, 4, 6, 8, 12, 16, 24, 32, ... (each doubling split at its
 * midpoint) up to (and including) maxThreads itself, so "give everything
 * currently free" is always the last option. Empty if there isn't even
 * enough free RAM for a single thread. */
function threadTiers(maxThreads: number): number[] {
    if (maxThreads < 1) return [];
    const tiers: number[] = [1];
    for (let pow = 2; pow < maxThreads; pow *= 2) {
        tiers.push(pow);
        const mid = pow * 1.5;
        if (mid < maxThreads) tiers.push(mid);
    }
    tiers.push(maxThreads);
    return Array.from(new Set(tiers)).sort((a, b) => a - b);
}

function ShareContent({ React }: AppComponentProps) {
    const e = React.createElement;
    const ns = useQueuedNs();
    const addChildPid = useAddChildPid();

    const [pid, setPid] = React.useState(null); // non-null while a share daemon is running
    const [runningThreads, setRunningThreads] = React.useState(0);
    const [selectedThreads, setSelectedThreads] = React.useState(1);
    const [costPerThread, setCostPerThread] = React.useState(0);
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState(null);

    const homeRam = useHomeRam();
    const sharing = pid != null;
    const freeRam = homeRam.max - homeRam.used;
    const maxThreads = costPerThread > 0 ? Math.floor(freeRam / costPerThread) : 0;
    const tiers = threadTiers(maxThreads);

    // This component remounts every time the window is opened — re-detect
    // an already-running daemons/share.daemon.js (from a previous open of this
    // window, or however else it got started) via ns.ps rather than
    // assuming nothing's happening, same as the Trainer app.
    React.useEffect(() => {
        let cancelled = false;
        (async () => {
            const cost = await ns.getScriptRam(DAEMON_SCRIPT, DAEMON_HOST);
            if (cancelled) return;
            setCostPerThread(cost);

            const processes = await ns.ps(DAEMON_HOST);
            if (cancelled) return;
            const proc = processes.find((p: { filename: string }) => p.filename === DAEMON_SCRIPT);
            if (proc) {
                setPid(proc.pid);
                setRunningThreads(proc.threads);
            }
        })();
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Default (or re-clamp) the selection to the smallest tier whenever the
    // current one is no longer valid (nothing picked yet, or free RAM
    // shrank out from under it) — same idea as the Cloud Servers app's RAM
    // picker defaulting to the cheapest affordable tier.
    React.useEffect(() => {
        if (sharing || tiers.length === 0) return;
        if (!tiers.includes(selectedThreads)) setSelectedThreads(tiers[0]);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tiers.join(",")]);

    // While sharing: notice if the daemon exited on its own (e.g. killed
    // some other way) so the button doesn't stay stuck on "Stop Sharing".
    React.useEffect(() => {
        if (pid == null) return;
        const interval = setInterval(() => {
            (async () => {
                const stillRunning = await ns.isRunning(pid);
                if (!stillRunning) {
                    setPid(null);
                    setRunningThreads(0);
                }
            })();
        }, 2000);
        return () => clearInterval(interval);
    }, [pid]);

    async function toggleSharing() {
        setBusy(true);
        setError(null);
        try {
            if (pid != null) {
                await ns.kill(pid);
                setPid(null);
                setRunningThreads(0);
                return;
            }

            // Defensive: the button is already disabled in this case, but
            // free RAM can change between renders.
            const requiredRam = selectedThreads * costPerThread;
            if (selectedThreads < 1 || requiredRam > freeRam) {
                setError(
                    `Not enough free RAM: ${selectedThreads} thread(s) needs ${requiredRam.toFixed(2)} GB, only ` +
                        `${freeRam.toFixed(2)} GB is free on ${DAEMON_HOST}.`
                );
                return;
            }

            const newPid = await ns.exec(DAEMON_SCRIPT, DAEMON_HOST, selectedThreads);
            if (newPid === 0) {
                setError(`Couldn't launch ${DAEMON_SCRIPT} — enough RAM? Is it deployed to ${DAEMON_HOST}?`);
                return;
            }

            setPid(newPid);
            setRunningThreads(selectedThreads);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            // No manual RAM refresh needed: HomeRamContext updates on its
            // own schedule (see ui/utils/home-ram-poller.ts) regardless of
            // what this app does.
            setBusy(false);
        }
    }

    const insufficientRam = !sharing && tiers.length === 0;

    const fieldStyle = {
        background: theme.well,
        color: theme.primary,
        border: `1px solid ${theme.primary}`,
        borderRadius: "4px",
        padding: "4px",
        fontFamily: "inherit",
    };

    // Same RAM bar as the Programs app (ui/apps/program-launcher.ts) — kept
    // visually identical since both apps are ultimately telling the player
    // the same thing about the same host.
    const homeRamPct = homeRam.max > 0 ? Math.min(100, (homeRam.used / homeRam.max) * 100) : 0;
    const ramBar = e(
        "div",
        { style: { marginBottom: "12px" } },
        e(
            "div",
            {
                style: {
                    position: "relative",
                    height: "14px",
                    borderRadius: "4px",
                    background: theme.well,
                    border: `1px solid ${theme.primaryDark}`,
                    overflow: "hidden",
                },
            },
            e("div", {
                style: {
                    position: "absolute",
                    inset: 0,
                    width: `${homeRamPct}%`,
                    background: homeRamPct > 90 ? theme.error : theme.primary,
                    transition: "width 0.2s ease",
                },
            })
        ),
        e(
            "div",
            { style: { fontSize: "11px", opacity: 0.85, marginTop: "4px", textAlign: "right" } },
            `${DAEMON_HOST}: ${homeRam.used.toFixed(2)} / ${homeRam.max.toFixed(2)} GB`
        )
    );

    // With nothing selectable (not even one thread fits), there's nothing
    // useful to show but why — no select with a single disabled placeholder,
    // no button that can never be clicked.
    if (insufficientRam) {
        return e(
            "div",
            null,
            ramBar,
            e(
                "div",
                { style: { color: theme.error, fontSize: "11px", ...wrapText } },
                `Needs at least ${costPerThread.toFixed(2)} GB free on ${DAEMON_HOST} to share a single thread — ` +
                    `only ${freeRam.toFixed(2)} GB is free. Free up RAM (e.g. stop other scripts) and this ` +
                    `unlocks automatically.`
            )
        );
    }

    return e(
        "div",
        null,
        ramBar,
        error
            ? e("div", { style: { color: theme.error, marginBottom: "8px", fontSize: "12px", ...wrapText } }, error)
            : null,
        !sharing
            ? e(
                  "label",
                  { style: { display: "flex", flexDirection: "column", gap: "4px", fontSize: "12px", marginBottom: "12px" } },
                  "RAM to share",
                  e(
                      "select",
                      {
                          value: selectedThreads,
                          onChange: (ev: any) => setSelectedThreads(Number(ev.target.value)),
                          style: fieldStyle,
                      },
                      ...tiers.map((threads) =>
                          e(
                              "option",
                              { key: threads, value: threads },
                              `${(threads * costPerThread).toFixed(0)} GB — ${threads} thread${threads === 1 ? "" : "s"}`
                          )
                      )
                  )
              )
            : e(
                  "div",
                  { style: { fontSize: "12px", marginBottom: "12px" } },
                  `Sharing ${(runningThreads * costPerThread).toFixed(0)} GB — ${runningThreads} thread${
                      runningThreads === 1 ? "" : "s"
                  }.`
              ),
        e(
            "button",
            {
                onClick: () => void toggleSharing(),
                disabled: busy,
                style: {
                    width: "100%",
                    background: sharing ? theme.errorDark : theme.button,
                    color: sharing ? theme.error : theme.primary,
                    border: `1px solid ${sharing ? theme.error : theme.primary}`,
                    borderRadius: "4px",
                    padding: "6px 10px",
                    cursor: busy ? "default" : "pointer",
                    opacity: busy ? 0.6 : 1,
                    fontFamily: "inherit",
                },
            },
            busy ? "..." : sharing ? "Stop Sharing" : "Start Sharing"
        )
    );
}

export const ShareApp: AppDefinition = {
    id: "share",
    icon: "🤝",
    label: "Share",
    Content: ShareContent,
};
