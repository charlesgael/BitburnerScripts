/**
 * Toast notifications for app code, backed by the vendored `notyf` library
 * (see `assets/vendor/notyf-lib.ts`) that `assets.app.ts` loads into the
 * live page as `window.Notyf`. Per CLAUDE.md, this is the *only* sanctioned
 * way to show a notification anywhere in `ui/apps/` — don't hand-roll
 * another self-dismissing banner.
 *
 * Pure DOM/`window` access, no `ns.*` calls — safe to import directly into
 * `ui.app.ts`'s reachable code (unlike a Singularity action, this costs no
 * RAM either way) and safe to call straight from a React event handler
 * without going through the queued `ns` proxy.
 */

let notyf: any = null;

/** Lazily creates (once) and returns the shared `Notyf` instance, styled to
 * roughly match the game's active theme. Returns null if `assets.app.js`
 * hasn't been run yet — `window.Notyf` doesn't exist — so callers can no-op
 * instead of throwing. */
function getNotyf(): any {
    if (notyf) return notyf;

    const win = eval("window");
    if (!win.Notyf) return null;

    notyf = new win.Notyf({
        duration: 3000,
        position: { x: "right", y: "bottom" },
        dismissible: true,
        types: [
            { type: "success", background: "var(--bb-theme-primarydark, #0a0)" },
            { type: "error", background: "var(--bb-theme-errordark, #1a0000)" },
        ],
    });
    return notyf;
}

/** Shows a brief success toast, e.g. after an action completes. */
export function notifySuccess(message: string): void {
    getNotyf()?.success(message);
}

/** Shows a brief error toast. Most of this codebase instead keeps errors
 * pinned in an inline banner until the next action (see `file-explorer.tsx`'s
 * `actionError`) — reach for this only where a transient error is enough. */
export function notifyError(message: string): void {
    getNotyf()?.error(message);
}
