import { NS } from "@ns";
import { STAT_PROVIDERS, StatValue } from "../stats/registry";

const HOOK_ID = "overview-extra-hook-0";
const REFRESH_INTERVAL_MS = 2000;

/**
 * Fills the overview panel's `#overview-extra-hook-0` cell with the
 * enabled stats from `ui/stats/registry.ts`, one per line — matching how
 * the rest of the overview shows each stat (Hack, Str, ...) as its own
 * row, with a thin progress bar directly underneath for the trainable
 * ones. `#overview-extra-hook-0` is one cell, not a way to add real table
 * rows, so this recreates that same rhythm (label+value line, bar line
 * right below it when there is one) inside that one cell instead.
 *
 * Call `refresh(ns, doc, now)` from the main loop's idle branch (see
 * `ui.app.ts`) — productive use of the time it'd otherwise spend just
 * sleeping. Takes the real `ns` directly, not the queued proxy: this runs
 * inside the same branch that's the sole consumer draining `nsQueue`, so a
 * provider awaiting a *queued* call here would deadlock — nothing would be
 * left to drain it until this same call returns.
 *
 * Throttled to once every `REFRESH_INTERVAL_MS`, since idle ticks fire
 * every ~100ms and most of these stats don't change nearly that often.
 *
 * This builds plain DOM (not React) — it's a single cell it's filling in,
 * not worth a whole extra ReactDOM.render root for. Unlike the containers
 * in `ui/utils/mount.ts`, `#overview-extra-hook-0` isn't a node this
 * component created — it's the game's own, just borrowed — so on exit call
 * `destroy(doc)` (from `ns.atExit`, alongside `unmountContainer`) to clear
 * the lines and inline style back out instead of leaving them behind for
 * whatever mounts into that hook next (or forever, if nothing does).
 */
export function createOverviewStats() {
    let lastRefresh = 0;

    function renderLine(doc: any, value: StatValue): any {
        const line = doc.createElement("div");
        line.style.cssText = "margin-bottom: 4px;";

        const row = doc.createElement("div");
        row.style.cssText = "display: flex; margin: 0 8px;";

        const labelDiv = doc.createElement("div");
        labelDiv.style.cssText = "flex: 1;";
        labelDiv.textContent = value.label;
        row.appendChild(labelDiv);

        const valueDiv = doc.createElement("div");
        valueDiv.textContent = value.value;
        row.appendChild(valueDiv);

        line.appendChild(row);

        if (value.kind === "bar") {
            const track = doc.createElement("div");
            track.style.cssText =
                "height: 2px; margin: 2px 4px 0; border-radius: 0; overflow: hidden; " +
                "background: var(--bb-theme-well, #0b0f0b);";
            const fill = doc.createElement("div");
            fill.style.cssText =
                `height: 100%; width: ${value.pct}%; border-radius: 0; transition: width 0.3s ease; ` +
                "background: var(--bb-theme-primary, #0f0);";
            track.appendChild(fill);
            line.appendChild(track);
        }

        return line;
    }

    async function refresh(ns: NS, doc: any, now: number) {
        if (now - lastRefresh < REFRESH_INTERVAL_MS) return;
        lastRefresh = now;

        const el = doc.getElementById(HOOK_ID);
        if (!el) return; // overview panel not mounted (e.g. collapsed) right now

        el.style.cssText = "display: flex; flex-direction: column;";

        const lines: any[] = [];
        for (const provider of STAT_PROVIDERS) {
            if (!provider.enabled) continue;
            try {
                lines.push(renderLine(doc, await provider.compute(ns)));
            } catch {
                // One provider failing (API not unlocked, etc.) shouldn't
                // blank out the rest.
            }
        }

        el.replaceChildren(...lines);
    }

    /** Clears the hook back to empty and drops the inline style `refresh`
     * set on it. Safe to call even if `refresh` never ran (e.g. the
     * overview panel was collapsed the whole session) or the hook is
     * currently missing. */
    function destroy(doc: any) {
        const el = doc.getElementById(HOOK_ID);
        if (!el) return;
        el.replaceChildren();
        el.style.cssText = "";
    }

    return { refresh, destroy };
}
