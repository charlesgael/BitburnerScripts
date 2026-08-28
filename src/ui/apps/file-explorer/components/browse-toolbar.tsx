import type { FileExplorerState } from '../logic/use-file-explorer'

/**
 * Up/breadcrumb/refresh/new-file toolbar, the new-file inline form, and
 * the search box — everything above the host sidebar + file grid.
 */
export function BrowseToolbar({ React, fx }: { React: any, fx: FileExplorerState }) {
  return (
    <React.Fragment>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px', flexShrink: 0 }}>
        <button onClick={fx.goUp} disabled={!fx.currentPath} title="Up one folder" className="bb-btn bb-btn--sm">
          ⬆
        </button>
        <div className="bb-wrap" style={{ flex: 1, minWidth: 0 }}>
          <span
            onClick={() => fx.navigate('')}
            style={{ cursor: 'pointer', textDecoration: fx.currentPath ? 'underline' : 'none' }}
          >
            {fx.hostIcon}
            {' '}
            {fx.selectedHost}
          </span>
          {fx.crumbs.map((seg: string, i: number) => (
            <span key={i}>
              {' / '}
              <span
                onClick={() => fx.navigate(fx.crumbs.slice(0, i + 1).join('/'))}
                style={{ cursor: 'pointer', textDecoration: i < fx.crumbs.length - 1 ? 'underline' : 'none' }}
              >
                {seg}
              </span>
            </span>
          ))}
        </div>
        <button
          onClick={() => void fx.loadFiles(fx.selectedHost)}
          disabled={fx.filesLoading}
          title="Refresh this folder"
          className="bb-btn bb-btn--sm"
        >
          {fx.filesLoading ? '...' : '⟳'}
        </button>
        <button
          onClick={() => {
            fx.setNewFileOpen((v: boolean) => !v)
            fx.setNewFileName('')
          }}
          disabled={fx.selectedHost !== 'home'}
          title={
            fx.selectedHost !== 'home'
              ? 'New files can only be created on home (ns.write always targets home)'
              : 'New text file'
          }
          className="bb-btn bb-btn--sm"
        >
          ＋
        </button>
      </div>

      {fx.newFileOpen
        ? (
            <div style={{ display: 'flex', gap: '6px', marginBottom: '6px', flexShrink: 0 }}>
              <input
                type="text"
                value={fx.newFileName}
                placeholder="notes.txt"
                onChange={(ev: any) => fx.setNewFileName(ev.target.value)}
                className="bb-field bb-field--sm bb-field--block"
              />
              <button
                onClick={() => void fx.createNewFile()}
                disabled={fx.actionBusy || !fx.newFileName.trim()}
                className="bb-btn bb-btn--sm"
              >
                Create
              </button>
              <button onClick={() => fx.setNewFileOpen(false)} className="bb-btn bb-btn--sm">
                Cancel
              </button>
            </div>
          )
        : null}

      <input
        type="text"
        value={fx.search}
        placeholder="🔎 Search this folder"
        onChange={(ev: any) => fx.setSearch(ev.target.value)}
        className="bb-field bb-field--sm bb-field--block"
        style={{ marginBottom: '6px', flexShrink: 0 }}
      />
    </React.Fragment>
  )
}
