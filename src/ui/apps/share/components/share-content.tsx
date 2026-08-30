import React from '@react'
import { TitlebarToolbar } from '../../../components/window/titlebar-toolbar'
import { useShare } from '../logic/use-share'
import { ShareHostCard } from './share-host-card'

/**
 * Root component: the refresh header and the per-host card grid. See
 * `../index.ts`'s header comment for what this app does and why.
 *
 * The hook's return is named `shareState`, not `share` — Bitburner's RAM
 * analyzer flags *any* identifier token that lexically matches a real
 * `ns.*` method name, in any role at all (a call, a property access, or —
 * as `const share = ...` was here — a bare local variable declaration with
 * nothing to do with `ns`), not just literal `.methodName(` call syntax.
 * That's what silently added `ns.share()`'s 2.4GB to `ui.app.js`'s measured
 * cost despite this file never calling it — same root cause as
 * `ns-queue.ts`'s original `run`→`enqueue` rename, just triggered by a
 * declaration instead of a call this time. See
 * `docs/epic-cgd-namespace.md`'s "Validated assumptions" for the fuller
 * writeup.
 */
export function ShareContent() {
  const shareState = useShare()

  return (
    <>
      <TitlebarToolbar>
        <button
          onClick={() => void shareState.refresh()}
          disabled={shareState.loading}
          className="bb-icon-link"
        >
          🗘
        </button>
      </TitlebarToolbar>
      <div>
        {shareState.error
          ? (
              <div
                className="bb-text-error bb-wrap"
                style={{
                  fontSize: '11px',
                  marginBottom: '8px',
                }}
              >
                {shareState.error}
              </div>
            )
          : null}

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
            gap: '8px',
          }}
        >
          {shareState.hosts.map(host => (
            <ShareHostCard
              key={host.hostname}
              ns={shareState.ns}
              host={host}
              onRamUsedChange={shareState.updateCloudUsedRam}
            />
          ))}
        </div>
      </div>
    </>
  )
}
