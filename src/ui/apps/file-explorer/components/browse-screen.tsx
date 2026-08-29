import type { FileExplorerState } from '../logic/use-file-explorer'
import React from '@react'
import { ActionBar } from './action-bar'
import { BrowseToolbar } from './browse-toolbar'
import { FileGrid } from './file-grid'
import { HostSidebar } from './host-sidebar'

/**
 * The main browse screen: toolbar, host sidebar + file grid, and the
 * selected-file action bar. Shown whenever `fx.mode !== "edit"`.
 */
export function BrowseScreen({ fx }: { fx: FileExplorerState }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: '380px', fontSize: '12px' }}>
      {fx.copyMenuFor
        ? (
            <div onClick={() => fx.setCopyMenuFor(null)} style={{ position: 'fixed', inset: 0, zIndex: 1 }} />
          )
        : null}

      {fx.actionError
        ? (
            <div
              className="bb-text-error bb-wrap"
              style={{ fontSize: '11px', marginBottom: '6px', flexShrink: 0 }}
            >
              {fx.actionError}
            </div>
          )
        : null}

      <BrowseToolbar fx={fx} />

      <div style={{ display: 'flex', flex: '1 1 auto', minHeight: 0, gap: '8px' }}>
        <HostSidebar fx={fx} />
        <FileGrid fx={fx} />
      </div>

      <ActionBar fx={fx} />

      <div style={{ fontSize: '10px', opacity: 0.6, marginTop: '4px', flexShrink: 0 }}>
        {fx.entries.length}
        {' '}
        item
        {fx.entries.length === 1 ? '' : 's'}
      </div>
    </div>
  )
}
