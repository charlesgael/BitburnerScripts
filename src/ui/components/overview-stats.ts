import { CgdStore } from "../../cgd/types";
import { StatValue } from "../../cgd/stats";

const HOOK_ID = "overview-extra-hook-0";

/**
 * Fills the overview panel's `#overview-extra-hook-0` cell with whatever's
 * currently in `cgd.store`'s `stats` slice — one line per entry, matching
 * how the rest of the overview shows each stat (Hack, Str, ...) as its own
 * row, with a thin progress bar directly underneath for the ones with a
 * `pct`. `#overview-extra-hook-0` is one cell, not a way to add real table
 * rows, so this recreates that same rhythm (label+value line, bar line
 * right below it when there is one) inside that one cell instead.
 *
 * This component no longer computes anything itself — a tiered daemon does
 * that now (see `cgd/stat-push.ts`) and pushes the result into the store;
 * this just renders whatever's there and re-renders on `store.subscribe`.
 * Deliberately still plain DOM (`doc.createElement`), not React, even
 * though the store now supports exactly the kind of subscribe-based
 * re-render a React rewrite was originally floated for: the plain-DOM
 * approach gets the same "only re-render when the store actually changes"
 * behavior for free via `subscribe`, with zero risk to
 * `assets/overview.ts`'s CSS (which targets this cell's children by fixed
 * DOM position, not id/class) — a JSX rewrite can still happen later if a
 * concrete reason for it shows up, but isn't needed just to get live
 * updates.
 *
 * Renders in whatever order `Object.values` walks `stats`'s keys, which
 * for string keys is insertion order — `stat-push.ts` inserts `home-ram`
 * first, then each provider in `BASELINE_STAT_PROVIDERS`' listed order, so
 * this doesn't need its own explicit ordering on top of that.
 *
 * Call `start(doc, store)` once, after mounting — immediately renders the
 * store's current snapshot, then subscribes for future changes. Call
 * `destroy(doc)` (from `ui.app.ts`'s explicit `stop` handling, or before
 * remounting) to unsubscribe and clear the hook back to empty; unlike the
 * containers in `ui/utils/mount.ts`, `#overview-extra-hook-0` isn't a node
 * this component created — it's the game's own, just borrowed.
 */
export function createOverviewStats() {
    let unsubscribe: (() => void) | null = null;

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

    function renderAll(doc: any, stats: Record<string, StatValue>) {
        const el = doc.getElementById(HOOK_ID);
        if (!el) return; // overview panel not mounted (e.g. collapsed) right now

        el.style.cssText = "display: flex; flex-direction: column;";
        el.replaceChildren(...Object.values(stats).map((value) => renderLine(doc, value)));
    }

    function start(doc: any, store: CgdStore) {
        renderAll(doc, store.getState().stats);
        unsubscribe = store.subscribe(() => renderAll(doc, store.getState().stats));
    }

    /** Unsubscribes from the store and clears the hook back to empty,
     * dropping the inline style `renderAll` set on it. Safe to call even if
     * `start` never ran, or the hook is currently missing. */
    function destroy(doc: any) {
        if (unsubscribe) {
            unsubscribe();
            unsubscribe = null;
        }
        const el = doc.getElementById(HOOK_ID);
        if (!el) return;
        el.replaceChildren();
        el.style.cssText = "";
    }

    return { start, destroy };
}
