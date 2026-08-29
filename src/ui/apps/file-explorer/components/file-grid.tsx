import type { FileExplorerState } from '../logic/use-file-explorer'
import React from '@react'
import { FOLDER_ICON, iconForFile } from '../../../utils/file-types'

/** The folder/file grid for the current host + path. */
export function FileGrid({ fx }: { fx: FileExplorerState }) {
  return (
    <div
      onClick={(ev: any) => {
        if (ev.target === ev.currentTarget)
          fx.setSelected(null)
      }}
      className="bb-panel"
      style={{
        flex: 1,
        minHeight: 0,
        overflowY: 'auto',
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(72px, 1fr))',
        gap: '6px',
        alignContent: 'start',
        padding: '6px',
      }}
    >
      {fx.filesLoading
        ? (
            <div style={{ gridColumn: '1 / -1', opacity: 0.7 }}>Loading…</div>
          )
        : fx.filesError
          ? (
              <div className="bb-text-error bb-wrap" style={{ gridColumn: '1 / -1' }}>
                {fx.filesError}
              </div>
            )
          : fx.entries.length === 0
            ? (
                <div style={{ gridColumn: '1 / -1', opacity: 0.7 }}>Empty folder.</div>
              )
            : (
                fx.entries.map(e => (
                  <div
                    key={e.fullPath}
                    onClick={() => {
                      if (!e.isFolder)
                        fx.setSelected(e.fullPath)
                    }}
                    onDoubleClick={() => fx.handleOpenEntry(e)}
                    title={e.name}
                    className={`bb-list-item${fx.selected === e.fullPath ? ' bb-list-item--selected' : ''}`}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: '2px',
                      padding: '6px 2px',
                    }}
                  >
                    <span style={{ fontSize: '22px', lineHeight: 1 }}>
                      {e.isFolder ? FOLDER_ICON : iconForFile(e.name)}
                    </span>
                    <span className="bb-wrap" style={{ fontSize: '10px', textAlign: 'center', maxWidth: '100%' }}>
                      {e.name}
                    </span>
                  </div>
                ))
              )}
    </div>
  )
}
