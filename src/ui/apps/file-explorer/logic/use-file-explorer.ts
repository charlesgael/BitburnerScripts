import type { CgdQueue } from '../../../../cgd/types'
import type { QueuedNS } from '../../../utils/ns-proxy'
import type { Entry, HostEntry } from './types'
import React from '@react'
import { fetchCloudList } from '../../../utils/cloud-list'
import { isRunnable } from '../../../utils/file-types'
import { readNetworkHosts } from '../../../utils/network-hosts'
import { notifySuccess } from '../../../utils/notify'
import { pullRemoteFile, pushRemoteFile } from '../../../utils/remote-file-bounce'
import { canViewFile } from './can-view-file'
import { computeEntries } from './compute-entries'

/**
 * All File Explorer state and behavior — every host/file load, the
 * browse/edit mode switch, and every file operation (view, save, run, kill,
 * tail, rename, delete, copy, create) — split out of `../components/` so
 * those stay plain presentational JSX driven entirely off this hook's
 * return value. See `../index.ts`'s header comment for the app's own
 * design notes (why everything goes through the queued `ns`, the
 * View/Edit host restrictions, etc).
 *
 * `ns` is typed `QueuedNS` (not `any`, as it was before) specifically so
 * every call below has to go through its `_`-prefixed methods — see
 * `ns-proxy.ts`'s header comment for why an untyped/loosely-typed `ns`
 * parameter is exactly what let this file's calls silently inflate
 * `ui.app.js`'s measured RAM cost without the compiler ever catching it.
 */
export function useFileExplorer(
  ns: QueuedNS,
  addChildPid: (pid: number) => void,
  callAction: CgdQueue['enqueueAction'],
) {
  const [hosts, setHosts] = React.useState<HostEntry[]>([
    { hostname: 'home', icon: '🏠' },
  ])
  const [hostsLoading, setHostsLoading] = React.useState(true)

  const [selectedHost, setSelectedHost] = React.useState('home')
  const [currentPath, setCurrentPath] = React.useState('')
  const [files, setFiles] = React.useState<string[]>([])
  const [filesLoading, setFilesLoading] = React.useState(true)
  const [filesError, setFilesError] = React.useState<string | null>(null)
  const [search, setSearch] = React.useState('')

  const [selected, setSelected] = React.useState<string | null>(null)
  const [selectedRunning, setSelectedRunning] = React.useState(false)

  const [mode, setMode] = React.useState('browse') // "browse" | "edit"
  const [editingPath, setEditingPath] = React.useState<string | null>(null)
  // Which host `editingPath` actually lives on — "home" for a plain local
  // (or already-cached, see `remote-file-bounce.ts`) file, or the origin
  // host when opened via that host's own listing, in which case Save
  // round-trips the edit back to it instead of just writing locally.
  const [editingHost, setEditingHost] = React.useState('home')
  const [editContent, setEditContent] = React.useState('')
  const [editDirty, setEditDirty] = React.useState(false)
  const [editBusy, setEditBusy] = React.useState(false)
  const [editError, setEditError] = React.useState<string | null>(null)
  const [confirmDiscardEditor, setConfirmDiscardEditor] = React.useState(false)

  const [renaming, setRenaming] = React.useState<string | null>(null)
  const [renameValue, setRenameValue] = React.useState('')
  const [confirmDelete, setConfirmDelete] = React.useState<string | null>(null)
  const [copyMenuFor, setCopyMenuFor] = React.useState<string | null>(null)

  const [newFileOpen, setNewFileOpen] = React.useState(false)
  const [newFileName, setNewFileName] = React.useState('')

  const [actionBusy, setActionBusy] = React.useState(false)
  const [actionError, setActionError] = React.useState<string | null>(null)

  async function loadHosts() {
    setHostsLoading(true)
    const result: HostEntry[] = [{ hostname: 'home', icon: '🏠' }]
    const seen = new Set(['home'])
    try {
      const cloud = await fetchCloudList(callAction)
      for (const s of cloud.servers) {
        if (seen.has(s.hostname))
          continue
        result.push({ hostname: s.hostname, icon: '🖥️' })
        seen.add(s.hostname)
      }
    }
    catch {
      // No free RAM to list cloud servers right now — proceed with
      // whatever hosts we already have rather than blocking the
      // whole app on it.
    }
    try {
      const known = await readNetworkHosts(ns)
      for (const h of known) {
        if (seen.has(h.hostname))
          continue
        result.push({ hostname: h.hostname, icon: '🌐' })
        seen.add(h.hostname)
      }
    }
    catch {
      // known-servers.json.txt missing/unreadable — fine, home (and
      // any cloud servers found above) is still browsable.
    }
    setHosts(result)
    setHostsLoading(false)
  }

  async function loadFiles(host: string) {
    setFilesLoading(true)
    setFilesError(null)
    try {
      const list = await ns._ls(host)
      setFiles(list)
    }
    catch (err) {
      setFilesError(err instanceof Error ? err.message : String(err))
      setFiles([])
    }
    finally {
      setFilesLoading(false)
    }
  }

  // This component remounts every time the window is opened (or its
  // title-bar refresh is clicked) — fetch everything fresh rather than
  // trusting stale state.
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      await loadHosts()
      if (cancelled)
        return
      await loadFiles('home')
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react/exhaustive-deps
  }, [])

  // Whenever the selected file changes, check whether it's currently
  // running (only meaningful for scripts) so the action bar can offer
  // Kill/Tail instead of Run.
  React.useEffect(() => {
    let cancelled = false
    if (!selected || !isRunnable(selected)) {
      setSelectedRunning(false)
      return
    }
    (async () => {
      const running = await ns._isRunning(selected, selectedHost)
      if (!cancelled)
        setSelectedRunning(running)
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react/exhaustive-deps
  }, [selected, selectedHost])

  function resetSelectionState() {
    setSelected(null)
    setRenaming(null)
    setConfirmDelete(null)
    setCopyMenuFor(null)
    setActionError(null)
    setNewFileOpen(false)
  }

  function selectHost(hostname: string) {
    if (hostname === selectedHost)
      return
    setSelectedHost(hostname)
    setCurrentPath('')
    resetSelectionState()
    void loadFiles(hostname)
  }

  function navigate(path: string) {
    setCurrentPath(path)
    resetSelectionState()
  }

  function goUp() {
    navigate(currentPath.split('/').slice(0, -1).join('/'))
  }

  function handleOpenEntry(e: Entry) {
    if (e.isFolder) {
      navigate(e.fullPath)
    }
    else if (canViewFile(e.name, selectedHost)) {
      void openViewer(e.fullPath, selectedHost)
    }
    else {
      setSelected(e.fullPath)
    }
  }

  /**
   * Opens `path` from `host` in the View/Edit screen — reading it
   * directly if `host` is `home`, or via `pullRemoteFile`'s cache bounce
   * otherwise (see `ui/utils/remote-file-bounce.ts`).
   */
  async function openViewer(path: string, host: string) {
    setActionError(null)
    setEditError(null)
    setEditBusy(true)
    try {
      const content = host === 'home' ? await ns._read(path) : await pullRemoteFile(ns, host, path)
      setEditContent(content)
      setEditDirty(false)
      setConfirmDiscardEditor(false)
      setEditingPath(path)
      setEditingHost(host)
      setMode('edit')
    }
    catch (err) {
      // Still on the browse screen at this point (mode/editingPath
      // are only set on success) — editError only ever renders inside
      // the edit screen, so a failure here also needs to go through
      // actionError (rendered in browse mode) or it'd be invisible.
      const message = err instanceof Error ? err.message : String(err)
      setEditError(message)
      setActionError(message)
    }
    finally {
      setEditBusy(false)
    }
  }

  async function saveEdit() {
    if (!editingPath)
      return
    setEditBusy(true)
    setEditError(null)
    try {
      if (editingHost === 'home') {
        await ns._write(editingPath, editContent, 'w')
      }
      else {
        await pushRemoteFile(ns, editingHost, editingPath, editContent)
      }
      setEditDirty(false)
    }
    catch (err) {
      setEditError(err instanceof Error ? err.message : String(err))
    }
    finally {
      setEditBusy(false)
    }
  }

  function closeEditor() {
    if (editDirty && !confirmDiscardEditor) {
      setConfirmDiscardEditor(true)
      return
    }
    setMode('browse')
    setEditingPath(null)
    setEditingHost('home')
    setEditContent('')
    setEditDirty(false)
    setConfirmDiscardEditor(false)
    setEditError(null)
  }

  async function runFile(path: string) {
    setActionBusy(true)
    setActionError(null)
    try {
      const pid = await ns._exec(path, selectedHost, 1)
      if (pid === 0) {
        throw new Error(`Couldn't start ${path} on ${selectedHost} — enough free RAM, and root access?`)
      }
      setSelectedRunning(true)
    }
    catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
    }
    finally {
      setActionBusy(false)
    }
  }

  async function killFile(path: string) {
    setActionBusy(true)
    setActionError(null)
    try {
      await ns._kill(path, selectedHost)
      setSelectedRunning(false)
    }
    catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
    }
    finally {
      setActionBusy(false)
    }
  }

  async function tailFile(path: string) {
    await ns._ui._openTail(path, selectedHost)
  }

  function startRename(path: string) {
    setRenaming(path)
    setRenameValue(path.slice(currentPath ? currentPath.length + 1 : 0))
    setActionError(null)
  }

  async function confirmRename() {
    if (!renaming)
      return
    const newName = renameValue.trim()
    if (!newName || newName.includes('/')) {
      setActionError('Enter a valid file name (no "/").')
      return
    }
    const prefix = currentPath ? `${currentPath}/` : ''
    const destination = `${prefix}${newName}`
    if (destination === renaming) {
      setRenaming(null)
      return
    }
    setActionBusy(true)
    setActionError(null)
    try {
      await ns._mv(selectedHost, renaming, destination)
      setRenaming(null)
      setSelected(destination)
      await loadFiles(selectedHost)
    }
    catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
    }
    finally {
      setActionBusy(false)
    }
  }

  function handleDeleteClick(path: string) {
    if (confirmDelete === path) {
      void doDelete(path)
    }
    else {
      setConfirmDelete(path)
    }
  }

  async function doDelete(path: string) {
    setConfirmDelete(null)
    setActionBusy(true)
    setActionError(null)
    try {
      const ok = await ns._rm(path, selectedHost)
      if (!ok)
        throw new Error('Delete failed — is the file currently running?')
      if (selected === path)
        setSelected(null)
      await loadFiles(selectedHost)
    }
    catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
    }
    finally {
      setActionBusy(false)
    }
  }

  async function copyTo(path: string, destHost: string) {
    setCopyMenuFor(null)
    setActionBusy(true)
    setActionError(null)
    try {
      const ok = await ns._scp(path, destHost, selectedHost)
      if (!ok)
        throw new Error(`Copy to ${destHost} failed.`)
      notifySuccess(ns, `Copied ${path} to ${destHost}`)
    }
    catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
    }
    finally {
      setActionBusy(false)
    }
  }

  async function createNewFile() {
    const name = newFileName.trim()
    if (!name)
      return
    const prefix = currentPath ? `${currentPath}/` : ''
    const fullPath = `${prefix}${name}`
    setActionBusy(true)
    setActionError(null)
    try {
      if (await ns._fileExists(fullPath, 'home')) {
        throw new Error(`${name} already exists.`)
      }
      await ns._write(fullPath, '', 'w')
      setNewFileOpen(false)
      setNewFileName('')
      await loadFiles('home')
      setSelected(fullPath)
    }
    catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
    }
    finally {
      setActionBusy(false)
    }
  }

  const entries = computeEntries(files, currentPath).filter(
    e => !search || e.name.toLowerCase().includes(search.toLowerCase()),
  )
  const crumbs = currentPath ? currentPath.split('/') : []
  const hostIcon = hosts.find(h => h.hostname === selectedHost)?.icon ?? '💻'

  return {
    // Hosts sidebar
    hosts,
    hostsLoading,
    selectedHost,
    selectHost,
    hostIcon,

    // Browse navigation
    currentPath,
    navigate,
    goUp,
    crumbs,
    loadFiles,

    // Files/search
    filesLoading,
    filesError,
    entries,
    search,
    setSearch,

    // Selection
    selected,
    setSelected,
    selectedRunning,
    handleOpenEntry,

    // Edit mode
    mode,
    editingPath,
    editingHost,
    editContent,
    setEditContent,
    editDirty,
    setEditDirty,
    editBusy,
    editError,
    confirmDiscardEditor,
    setConfirmDiscardEditor,
    openViewer,
    saveEdit,
    closeEditor,

    // Per-file actions
    runFile,
    killFile,
    tailFile,
    renaming,
    renameValue,
    setRenameValue,
    startRename,
    confirmRename,
    setRenaming,
    confirmDelete,
    handleDeleteClick,
    copyMenuFor,
    setCopyMenuFor,
    copyTo,
    newFileOpen,
    setNewFileOpen,
    newFileName,
    setNewFileName,
    createNewFile,
    actionBusy,
    actionError,
  }
}

/**
 * Everything a rendering component under `../components/` needs — the
 * hook's full return value, so each screen/subcomponent can just take a
 * single `fx: FileExplorerState` prop instead of dozens of individual ones.
 */
export type FileExplorerState = ReturnType<typeof useFileExplorer>
