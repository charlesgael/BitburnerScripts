import type { CgdDaemon, CgdTier } from '../../cgd/types'
import type { ReactGlobals } from '../types'

const TIER_POLL_MS = 1000

/**
 * Floating status panel: a live status line (the currently-running daemon's
 * tier) plus "Restart" and "Quit" buttons.
 *
 * The tier display is genuinely live, not a one-time snapshot — it used to
 * be (a fixed string `ui.app.ts` rendered once at mount), which meant
 * switching daemon tiers in the background left this panel showing the old
 * tier forever, the same staleness bug `app-grid.tsx`'s own tier polling
 * fixed for the icon grid. This polls the same live `getDaemon()` getter
 * (`() => cgd.daemon`, re-resolved every tick, never a fixed reference —
 * see `ns-proxy.ts`'s header comment for why that matters) every second and
 * re-renders on an actual change, same pattern as `app-grid.tsx`.
 *
 * Both buttons only flip a flag via their callback (`onStop`/`onRestart`)
 * — they don't touch React/DOM/`ns` directly, since doing real work from
 * inside a React event handler races with React's own reconciliation and
 * throws a concurrency error. `ui.app.ts` defers the actual work
 * (`setTimeout`) to a macrotask boundary instead.
 */
export function createStatusPanel(
  globals: ReactGlobals,
  container: any,
  getDaemon: () => CgdDaemon | undefined,
  onStop: () => void,
  onRestart: () => void,
) {
  const { React } = globals

  let daemonTier: CgdTier = getDaemon()?._getTier() ?? 0

  function render() {
    eval('window').ReactDOM.render(
      <div style={{ padding: '0 16px' }}>
        <hr className="MuiDivider-root MuiDivider-fullWidth css-8dakje" style={{ margin: '0 -16px 8px' }} />
        <div style={{ marginBottom: '8px', fontWeight: 'bold' }}>Bitburner UI</div>
        <div style={{ marginBottom: '10px', opacity: 0.85 }}>
          Daemon: tier
          {daemonTier}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <button onClick={onRestart} className="bb-btn">
            Restart
          </button>
          <button onClick={onStop} className="bb-btn bb-btn-danger">
            Quit
          </button>
        </div>
      </div>,
      container,
    )
  }

  const tierPollId = setInterval(() => {
    const next = getDaemon()?._getTier() ?? 0
    if (next === daemonTier)
      return
    daemonTier = next
    render()
  }, TIER_POLL_MS)

  function destroy() {
    clearInterval(tierPollId)
  }

  return { render, destroy }
}
