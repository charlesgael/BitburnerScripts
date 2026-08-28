import type { FileExplorerState } from '../logic/use-file-explorer'
import { iconForFile, isEditable } from '../../../utils/file-types'

/**
 * The View/Edit screen — shown instead of the browse screen while
 * `fx.mode === "edit"`. See `../index.ts`'s header comment for the
 * View/Edit host restrictions this enforces.
 */
export function EditScreen({ React, fx }: { React: any, fx: FileExplorerState }) {
  const editingPath = fx.editingPath as string
  const editable = isEditable(editingPath)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: '360px' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '8px',
          marginBottom: '8px',
          flexShrink: 0,
        }}
      >
        <span className="bb-wrap" style={{ fontWeight: 'bold', fontSize: '12px' }}>
          {fx.editingHost !== 'home' ? `${fx.editingHost}: ` : ''}
          {iconForFile(editingPath)}
          {' '}
          {editingPath}
          {fx.editDirty ? ' *' : ''}
        </span>
        <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
          {editable
            ? (
                <button
                  onClick={() => void fx.saveEdit()}
                  disabled={fx.editBusy || !fx.editDirty}
                  className="bb-btn bb-btn--sm"
                >
                  {fx.editBusy ? '...' : '💾 Save'}
                </button>
              )
            : null}
          <button onClick={fx.closeEditor} className="bb-btn bb-btn--sm">
            {fx.confirmDiscardEditor ? 'Discard?' : '✕ Close'}
          </button>
        </div>
      </div>
      {fx.editError
        ? (
            <div className="bb-text-error bb-wrap" style={{ fontSize: '11px', marginBottom: '8px' }}>
              {fx.editError}
            </div>
          )
        : null}
      {!editable
        ? (
            <div style={{ fontSize: '11px', opacity: 0.75, marginBottom: '6px' }}>
              Read-only — Bitburner doesn't support saving this file type.
            </div>
          )
        : fx.editingHost !== 'home'
          ? (
              <div style={{ fontSize: '11px', opacity: 0.75, marginBottom: '6px' }}>
                Saving pushes changes back to
                {' '}
                {fx.editingHost}
                . A cached copy also lives at
                {' '}
                remote/
                {fx.editingHost}
                /
                {editingPath}
                {' '}
                on home.
              </div>
            )
          : null}
      <textarea
        value={fx.editContent}
        readOnly={!editable}
        spellCheck={false}
        onChange={(ev: any) => {
          fx.setEditContent(ev.target.value)
          fx.setEditDirty(true)
          fx.setConfirmDiscardEditor(false)
        }}
        className="bb-field"
        style={{
          flex: '1 1 auto',
          minHeight: 0,
          resize: 'none',
          padding: '8px',
          fontFamily: 'Consolas, monospace',
          fontSize: '12px',
          whiteSpace: 'pre',
        }}
      />
    </div>
  )
}
