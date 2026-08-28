import type { QueuedNS } from './ns-proxy'

/**
 * Toast notifications for app code, backed by Bitburner's own built-in
 * `ns.toast` (bottom-right notification queue) — see `NetscriptDefinitions.d.ts`,
 * `toast(msg, variant?, duration?)`, RAM cost 0 GB. Per CLAUDE.md, this is the
 * only* sanctioned way to show a notification anywhere in `ui/apps/` — don't
 * hand-roll another self-dismissing banner, and don't vendor a third-party
 * toast library for something the game already exposes natively.
 *
 * `ns.toast` is a real `ns.*` call, so — like every other Netscript call
 * triggered from a React handler — it must go through the queued `ns` proxy
 * (`useQueuedNs()`), not a raw `ns`. Callers already have that proxy on hand
 * (it's threaded through every app's `Content` component), so these just take
 * it as a parameter instead of reaching for `window`/DOM globals.
 */

/** Shows a brief success toast, e.g. after an action completes. */
export function notifySuccess(ns: QueuedNS, message: string): void {
  void ns._toast(message, 'success')
}

/**
 * Shows a brief error toast. Most of this codebase instead keeps errors
 * pinned in an inline banner until the next action (see `file-explorer.tsx`'s
 * `actionError`) — reach for this only where a transient error is enough.
 */
export function notifyError(ns: QueuedNS, message: string): void {
  void ns._toast(message, 'error')
}
