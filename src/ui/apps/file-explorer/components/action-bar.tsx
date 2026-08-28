import type { FileExplorerState } from '../logic/use-file-explorer'
import { iconForFile, isCopyable, isDeletable, isMovable, isReadable, isRunnable } from '../../../utils/file-types'
import { canViewFile } from '../logic/can-view-file'

/**
 * The action bar for the currently-selected file: View/Edit, Run/Kill/
 * Tail, Rename, Copy to another host, Delete — each offered only when the
 * selected file's extension actually supports it (see
 * `ui/utils/file-types.ts`).
 */
export function ActionBar({ React, fx }: { React: any, fx: FileExplorerState }) {
  if (!fx.selected)
    return null
  const selected = fx.selected

  return (
    <div
      className="bb-divider-top"
      style={{
        marginTop: '6px',
        flexShrink: 0,
        paddingTop: '6px',
      }}
    >
      {fx.renaming === selected
        ? (
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <input
                type="text"
                value={fx.renameValue}
                onChange={(ev: any) => fx.setRenameValue(ev.target.value)}
                className="bb-field bb-field--sm bb-field--block"
              />
              <button
                onClick={() => void fx.confirmRename()}
                disabled={fx.actionBusy}
                className="bb-btn bb-btn--sm"
              >
                Save
              </button>
              <button onClick={() => fx.setRenaming(null)} className="bb-btn bb-btn--sm">
                Cancel
              </button>
            </div>
          )
        : (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' as const }}>
              <span className="bb-wrap" style={{ flex: '1 1 auto', fontSize: '11px', opacity: 0.85 }}>
                {iconForFile(selected)}
                {' '}
                {selected}
              </span>
              <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' as const }}>
                {canViewFile(selected, fx.selectedHost)
                  ? (
                      <button
                        onClick={() => void fx.openViewer(selected, fx.selectedHost)}
                        disabled={fx.actionBusy || fx.editBusy}
                        title={
                          fx.selectedHost !== 'home'
                            ? `Fetches a cached copy to remote/${fx.selectedHost}/... on home`
                            : undefined
                        }
                        className="bb-btn bb-btn--sm"
                      >
                        {fx.editBusy ? '...' : '👁 View'}
                      </button>
                    )
                  : isReadable(selected)
                    ? (
                        <button
                          disabled
                          title="Literature/message files can't be cached from another server — Copy to home, then view it there"
                          className="bb-btn bb-btn--sm"
                        >
                          👁 View
                        </button>
                      )
                    : null}
                {isRunnable(selected)
                  ? (
                      fx.selectedRunning
                        ? (
                            <React.Fragment>
                              <button
                                onClick={() => void fx.tailFile(selected)}
                                disabled={fx.actionBusy}
                                title="Open log window"
                                className="bb-btn bb-btn--sm"
                              >
                                📃
                              </button>
                              <button
                                onClick={() => void fx.killFile(selected)}
                                disabled={fx.actionBusy}
                                className="bb-btn bb-btn--sm bb-btn-danger"
                              >
                                ⏹ Kill
                              </button>
                            </React.Fragment>
                          )
                        : (
                            <button
                              onClick={() => void fx.runFile(selected)}
                              disabled={fx.actionBusy}
                              className="bb-btn bb-btn--sm"
                            >
                              ▶ Run
                            </button>
                          )
                    )
                  : null}
                {isMovable(selected)
                  ? (
                      <button
                        onClick={() => fx.startRename(selected)}
                        disabled={fx.actionBusy}
                        className="bb-btn bb-btn--sm"
                      >
                        ✏ Rename
                      </button>
                    )
                  : null}
                {isCopyable(selected)
                  ? (
                      <div
                        style={{
                          position: 'relative',
                          display: 'flex',
                          ...(fx.copyMenuFor === selected ? { zIndex: 2 } : {}),
                        }}
                      >
                        <button
                          onClick={() => fx.setCopyMenuFor(fx.copyMenuFor === selected ? null : selected)}
                          disabled={fx.actionBusy || fx.hosts.length <= 1}
                          className="bb-btn bb-btn--sm"
                        >
                          ⧉ Copy to ▾
                        </button>
                        {fx.copyMenuFor === selected
                          ? (
                              <div
                                className="bb-menu"
                                style={{
                                  position: 'absolute',
                                  bottom: '100%',
                                  right: 0,
                                  marginBottom: '2px',
                                  minWidth: '140px',
                                  maxHeight: '160px',
                                  overflowY: 'auto',
                                  overflowX: 'hidden',
                                }}
                              >
                                {fx.hosts
                                  .filter(h => h.hostname !== fx.selectedHost)
                                  .map(h => (
                                    <button
                                      key={h.hostname}
                                      onClick={() => void fx.copyTo(selected, h.hostname)}
                                      className="bb-menu-item"
                                    >
                                      {h.icon}
                                      {' '}
                                      {h.hostname}
                                    </button>
                                  ))}
                              </div>
                            )
                          : null}
                      </div>
                    )
                  : null}
                {isDeletable(selected)
                  ? (
                      <button
                        onClick={() => fx.handleDeleteClick(selected)}
                        disabled={fx.actionBusy}
                        className="bb-btn bb-btn--sm bb-btn-danger"
                      >
                        {fx.confirmDelete === selected ? 'Confirm?' : '🗑 Delete'}
                      </button>
                    )
                  : null}
              </div>
            </div>
          )}
    </div>
  )
}
