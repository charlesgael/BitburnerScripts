import type { ManagedAppDefinition } from '../logic/types'
import type { TaskManagerState } from '../logic/use-task-manager'

/**
 * Same spawn row for both loop apps and one-shot reports: the main button
 * always targets `home` directly — no picker in the way for the common
 * case — and a small "▾" button to its right opens a popup listing only
 * the non-reserved cloud servers with room for this app (and, for a loop
 * app, not already running it — see `useTaskManager`'s `hostOptions`);
 * picking one spawns there instead. A one-shot script often reads a file
 * local to whatever host it runs on (e.g. `backdoor.lite.app.js` reads
 * `known-servers.json.txt`, which `netmapper.app.js` only writes on the
 * host *it* was spawned on) — that's why one-shot apps get the same host
 * choice as loop apps instead of being locked to `home`. Since `tasks`
 * never contains a one-shot app's script, `hostOptions` naturally never
 * excludes a host for one-shot apps as "already running" — only the RAM
 * (and `requires`) checks apply.
 *
 * `app.singleInstance` (e.g. `flooder.app.js`) narrows `hostOptions` down to
 * nothing once it's running anywhere. `app.requires` (e.g. `cracker.app.js`
 * needing `netmapper.app.js` on the same host — see `logic/types.ts`)
 * doesn't gate a host at all any more — clicking Spawn auto-launches any
 * missing link in the chain first, one at a time, 1s apart (see
 * `useTaskManager`'s `spawnTask`); `hostOptions` only requires enough
 * combined free RAM for that chain plus `app` itself. This row surfaces
 * that chain (via `dependencyChainFor`) in the button's tooltip so a click
 * isn't a surprise.
 *
 * Two small badges after the label/RAM text flag an app's catalog-level
 * traits at a glance, independent of current run state: 🔗 for one that
 * declares `requires` at all (its full list, not just what's currently
 * missing — that's the button's own tooltip's job), and 1️⃣ for
 * `singleInstance`.
 */
export function SpawnRow({
  React,
  tm,
  app,
  appByScript,
}: {
  React: any
  tm: TaskManagerState
  app: ManagedAppDefinition
  appByScript: Record<string, ManagedAppDefinition>
}) {
  const required = (tm.appRam[app.script] ?? 0) * (app.threads ?? 1)
  const options = tm.hostOptions(app)
  const homeOption = options.find(o => o.host === 'home')
  const cloudOptions = options.filter(o => o.host !== 'home')
  const alreadyRunning = app.singleInstance
    ? tm.tasks.some(t => t.script === app.script)
    : tm.tasks.some(t => t.script === app.script && t.host === 'home')
  // `null` (see `./dependency-chain.ts`) means the chain is unsatisfiable
  // on home at all — currently unreachable (nothing `requires`-able is
  // also `singleInstance`), treated the same as "no RAM" below.
  const homeChain = tm.dependencyChainFor(app, 'home')
  const isOccupied = tm.spawnBusy.has(app.script)
  const homeDisabled = isOccupied || tm.loading || !homeOption
  const hasCloudOption = cloudOptions.length > 0
  const menuOpen = tm.openMenuFor === app.script

  const runLabel = app.oneShot ? 'Run' : 'Spawn'
  const mainLabel = isOccupied
    ? '...'
    : alreadyRunning
      ? 'Running'
      : !homeOption
          ? 'No RAM'
          : runLabel
  const mainTitle = alreadyRunning
    ? app.singleInstance
      ? 'Already running — see Running Tasks below'
      : 'Already running on home — see Running Tasks below'
    : !homeOption
        ? 'Not enough free RAM on home'
        : homeChain && homeChain.length > 0
          ? `Will also launch ${homeChain
            .map(a => a.label)
            .join(', ')} on home first, 1s apart`
          : undefined

  const mainButton = (
    <button
      onClick={() => void tm.spawnTask(app, 'home')}
      disabled={homeDisabled}
      title={mainTitle}
      className={`bb-btn${hasCloudOption ? ' bb-btn--split-left' : ''}`}
      style={{ minWidth: '60px' }}
    >
      {mainLabel}
    </button>
  )

  // A compact "▾" button, to the right of the main button, that toggles a
  // small popup menu listing only the compatible cloud servers — cheaper
  // on space than a native <select>, which always reserves room for its
  // widest option even closed. Wrapped in its own `position: relative`
  // box so the popup (position: absolute) anchors to it; gets a z-index
  // above the click-catching backdrop below only while its menu is open,
  // so the popup — and the arrow button itself, to keep toggling it
  // closed working — aren't hidden behind it.
  const cloudMenuButton = hasCloudOption
    ? (
        <div
          style={{
            position: 'relative',
            display: 'flex',
            ...(menuOpen ? { zIndex: 2 } : {}),
          }}
        >
          <button
            onClick={() => tm.setOpenMenuFor(menuOpen ? null : app.script)}
            disabled={isOccupied}
            title="Spawn on a cloud server instead"
            className="bb-btn bb-btn--split-right"
          >
            ▾
          </button>
          {menuOpen
            ? (
                <div
                  className="bb-menu"
                  style={{
                    position: 'absolute',
                    top: '100%',
                    right: 0,
                    marginTop: '2px',
                    minWidth: '170px',
                  }}
                >
                  {cloudOptions.map(o => (
                    <button
                      key={o.host}
                      onClick={() => {
                        tm.setOpenMenuFor(null)
                        void tm.spawnTask(app, o.host)
                      }}
                      className="bb-menu-item"
                    >
                      {o.host}
                      {' '}
                      (
                      {o.freeRam.toFixed(1)}
                      {' '}
                      GB free)
                    </button>
                  ))}
                </div>
              )
            : null}
        </div>
      )
    : null

  const requiresBadge
    = app.requires && app.requires.length > 0
      ? (
          <span
            title={`Requires ${app.requires
              .map(s => appByScript[s]?.label ?? s)
              .join(', ')} on the same host`}
            style={{ marginLeft: '4px', cursor: 'help' }}
          >
            🔗
          </span>
        )
      : null

  const singleInstanceBadge = app.singleInstance
    ? (
        <span
          title="Single instance"
          style={{ marginLeft: '4px', cursor: 'help' }}
        >
          ➊
        </span>
      )
    : null

  return (
    <div
      className="bb-divider-bottom"
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: '8px',
        padding: '6px 0',
      }}
    >
      <span className="bb-wrap" style={{ fontSize: '12px' }}>
        {app.label}
        {' '}
        (
        {required.toFixed(2)}
        {' '}
        GB)
        {requiresBadge}
        {singleInstanceBadge}
      </span>
      <div style={{ display: 'flex' }}>
        {mainButton}
        {cloudMenuButton}
      </div>
    </div>
  )
}
