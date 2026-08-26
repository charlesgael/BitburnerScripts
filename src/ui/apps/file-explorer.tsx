import { AppComponentProps, AppDefinition } from "../types";
import { useQueuedNs } from "../context/ns-queue-context";
import { useAddChildPid } from "../context/child-pids-context";
import { theme, wrapText } from "../utils/theme";
import { notifySuccess } from "../utils/notify";
import { fetchCloudList } from "../utils/cloud-list";
import { readNetworkHosts } from "../utils/network-hosts";
import { pullRemoteFile, pushRemoteFile } from "../utils/remote-file-bounce";
import {
    FOLDER_ICON,
    iconForFile,
    isReadable,
    isEditable,
    isMovable,
    isCopyable,
    isRunnable,
    isDeletable,
} from "../utils/file-types";

/** Whether View is actually offered for `name` while browsing `host`.
 * Local (`home`) files just need to be readable at all; a file on another
 * host additionally needs to be `isMovable` — the remote View/Edit cache
 * bounce (`ui/utils/remote-file-bounce.ts`) relies on `ns.mv`, which (unlike
 * `ns.scp`) doesn't support .lit/.msg. */
function canViewFile(name: string, host: string): boolean {
    return isReadable(name) && (host === "home" || isMovable(name));
}

/**
 * A small Windows-Explorer-flavored file browser: a left-hand list of
 * "drives" (`home`, purchased/cloud servers, and any host previously found
 * by Netmapper — see `ui/utils/network-hosts.ts`), a folder/file grid with
 * unicode icons (Bitburner has no real directories, so a "folder" here is
 * just a common "/"-prefix shared by several filenames — see
 * `computeEntries` below), and a per-file action bar (View/Edit, Run/Kill/
 * Tail, Rename, Copy to another host, Delete). Built for players who'd
 * rather click around than type terminal commands.
 *
 * Every file op here goes through the queued `ns` (see `ns-proxy.ts`)
 * exactly like every other app — no dedicated daemon needed, since
 * `ls`/`read`/`write`/`rm`/`mv`/`scp` together only add about 1.4 GB to
 * `ui.app.js`'s footprint (`getScriptRam`/`exec`/`kill`/`isRunning`/
 * `ui.openTail` are already paid for by the Programs/Trainer apps' task
 * manager — see `task-manager.tsx`), well under what a dedicated daemon
 * round-trip would cost in complexity for something this cheap.
 *
 * See `ui/utils/file-types.ts`'s header comment for the (real, not
 * arbitrary) per-extension capability rules this app enforces — most
 * importantly that View/Edit only ever works while browsing `home`, since
 * `ns.read`/`ns.write` have no host parameter and always target the
 * calling script's own server.
 */

interface HostEntry {
    hostname: string;
    icon: string;
}

interface Entry {
    name: string;
    fullPath: string;
    isFolder: boolean;
}

/** Splits `files` (a flat `ns.ls()` result) into the folders and files that
 * appear directly under `currentPath` — the same "one level at a time"
 * navigation a real file explorer gives you, built entirely client-side
 * since Bitburner itself only ever returns a flat list of full paths. */
function computeEntries(files: string[], currentPath: string): Entry[] {
    const prefix = currentPath ? `${currentPath}/` : "";
    const folderNames = new Set<string>();
    const fileEntries: Entry[] = [];
    for (const f of files) {
        if (!f.startsWith(prefix)) continue;
        const rest = f.slice(prefix.length);
        if (!rest) continue;
        const slash = rest.indexOf("/");
        if (slash === -1) {
            fileEntries.push({ name: rest, fullPath: f, isFolder: false });
        } else {
            folderNames.add(rest.slice(0, slash));
        }
    }
    const folderEntries: Entry[] = [...folderNames]
        .sort((a, b) => a.localeCompare(b))
        .map((name) => ({ name, fullPath: `${prefix}${name}`, isFolder: true }));
    fileEntries.sort((a, b) => a.name.localeCompare(b.name));
    return [...folderEntries, ...fileEntries];
}

function FileExplorerContent({ React }: AppComponentProps) {
    const ns = useQueuedNs();
    const addChildPid = useAddChildPid();

    const [hosts, setHosts]: [HostEntry[], (v: HostEntry[]) => void] = React.useState([
        { hostname: "home", icon: "🏠" },
    ]);
    const [hostsLoading, setHostsLoading] = React.useState(true);

    const [selectedHost, setSelectedHost] = React.useState("home");
    const [currentPath, setCurrentPath] = React.useState("");
    const [files, setFiles]: [string[], (v: string[]) => void] = React.useState([]);
    const [filesLoading, setFilesLoading] = React.useState(true);
    const [filesError, setFilesError]: [string | null, (v: string | null) => void] = React.useState(null);
    const [search, setSearch] = React.useState("");

    const [selected, setSelected]: [string | null, (v: string | null) => void] = React.useState(null);
    const [selectedRunning, setSelectedRunning] = React.useState(false);

    const [mode, setMode] = React.useState("browse"); // "browse" | "edit"
    const [editingPath, setEditingPath]: [string | null, (v: string | null) => void] = React.useState(null);
    // Which host `editingPath` actually lives on — "home" for a plain local
    // (or already-cached, see `remote-file-bounce.ts`) file, or the origin
    // host when opened via that host's own listing, in which case Save
    // round-trips the edit back to it instead of just writing locally.
    const [editingHost, setEditingHost] = React.useState("home");
    const [editContent, setEditContent] = React.useState("");
    const [editDirty, setEditDirty] = React.useState(false);
    const [editBusy, setEditBusy] = React.useState(false);
    const [editError, setEditError]: [string | null, (v: string | null) => void] = React.useState(null);
    const [confirmDiscardEditor, setConfirmDiscardEditor] = React.useState(false);

    const [renaming, setRenaming]: [string | null, (v: string | null) => void] = React.useState(null);
    const [renameValue, setRenameValue] = React.useState("");
    const [confirmDelete, setConfirmDelete]: [string | null, (v: string | null) => void] = React.useState(null);
    const [copyMenuFor, setCopyMenuFor]: [string | null, (v: string | null) => void] = React.useState(null);

    const [newFileOpen, setNewFileOpen] = React.useState(false);
    const [newFileName, setNewFileName] = React.useState("");

    const [actionBusy, setActionBusy] = React.useState(false);
    const [actionError, setActionError]: [string | null, (v: string | null) => void] = React.useState(null);

    async function loadHosts() {
        setHostsLoading(true);
        const result: HostEntry[] = [{ hostname: "home", icon: "🏠" }];
        const seen = new Set(["home"]);
        try {
            const cloud = await fetchCloudList(ns, addChildPid);
            for (const s of cloud.servers) {
                if (seen.has(s.hostname)) continue;
                result.push({ hostname: s.hostname, icon: "🖥️" });
                seen.add(s.hostname);
            }
        } catch {
            // No free RAM to list cloud servers right now — proceed with
            // whatever hosts we already have rather than blocking the
            // whole app on it.
        }
        try {
            const known = await readNetworkHosts(ns);
            for (const h of known) {
                if (seen.has(h.hostname)) continue;
                result.push({ hostname: h.hostname, icon: "🌐" });
                seen.add(h.hostname);
            }
        } catch {
            // known-servers.json.txt missing/unreadable — fine, home (and
            // any cloud servers found above) is still browsable.
        }
        setHosts(result);
        setHostsLoading(false);
    }

    async function loadFiles(host: string) {
        setFilesLoading(true);
        setFilesError(null);
        try {
            const list = await ns.ls(host);
            setFiles(list);
        } catch (err) {
            setFilesError(err instanceof Error ? err.message : String(err));
            setFiles([]);
        } finally {
            setFilesLoading(false);
        }
    }

    // This component remounts every time the window is opened (or its
    // title-bar refresh is clicked) — fetch everything fresh rather than
    // trusting stale state.
    React.useEffect(() => {
        let cancelled = false;
        (async () => {
            await loadHosts();
            if (cancelled) return;
            await loadFiles("home");
        })();
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Whenever the selected file changes, check whether it's currently
    // running (only meaningful for scripts) so the action bar can offer
    // Kill/Tail instead of Run.
    React.useEffect(() => {
        let cancelled = false;
        if (!selected || !isRunnable(selected)) {
            setSelectedRunning(false);
            return;
        }
        (async () => {
            const running = await ns.isRunning(selected, selectedHost);
            if (!cancelled) setSelectedRunning(running);
        })();
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selected, selectedHost]);

    function resetSelectionState() {
        setSelected(null);
        setRenaming(null);
        setConfirmDelete(null);
        setCopyMenuFor(null);
        setActionError(null);
        setNewFileOpen(false);
    }

    function selectHost(hostname: string) {
        if (hostname === selectedHost) return;
        setSelectedHost(hostname);
        setCurrentPath("");
        resetSelectionState();
        void loadFiles(hostname);
    }

    function navigate(path: string) {
        setCurrentPath(path);
        resetSelectionState();
    }

    function goUp() {
        navigate(currentPath.split("/").slice(0, -1).join("/"));
    }

    function handleOpenEntry(e: Entry) {
        if (e.isFolder) {
            navigate(e.fullPath);
        } else if (canViewFile(e.name, selectedHost)) {
            void openViewer(e.fullPath, selectedHost);
        } else {
            setSelected(e.fullPath);
        }
    }

    /** Opens `path` from `host` in the View/Edit screen — reading it
     * directly if `host` is `home`, or via `pullRemoteFile`'s cache bounce
     * otherwise (see `ui/utils/remote-file-bounce.ts`). */
    async function openViewer(path: string, host: string) {
        setActionError(null);
        setEditError(null);
        setEditBusy(true);
        try {
            const content = host === "home" ? await ns.read(path) : await pullRemoteFile(ns, host, path);
            setEditContent(content);
            setEditDirty(false);
            setConfirmDiscardEditor(false);
            setEditingPath(path);
            setEditingHost(host);
            setMode("edit");
        } catch (err) {
            // Still on the browse screen at this point (mode/editingPath
            // are only set on success) — editError only ever renders inside
            // the edit screen, so a failure here also needs to go through
            // actionError (rendered in browse mode) or it'd be invisible.
            const message = err instanceof Error ? err.message : String(err);
            setEditError(message);
            setActionError(message);
        } finally {
            setEditBusy(false);
        }
    }

    async function saveEdit() {
        if (!editingPath) return;
        setEditBusy(true);
        setEditError(null);
        try {
            if (editingHost === "home") {
                await ns.write(editingPath, editContent, "w");
            } else {
                await pushRemoteFile(ns, editingHost, editingPath, editContent);
            }
            setEditDirty(false);
        } catch (err) {
            setEditError(err instanceof Error ? err.message : String(err));
        } finally {
            setEditBusy(false);
        }
    }

    function closeEditor() {
        if (editDirty && !confirmDiscardEditor) {
            setConfirmDiscardEditor(true);
            return;
        }
        setMode("browse");
        setEditingPath(null);
        setEditingHost("home");
        setEditContent("");
        setEditDirty(false);
        setConfirmDiscardEditor(false);
        setEditError(null);
    }

    async function runFile(path: string) {
        setActionBusy(true);
        setActionError(null);
        try {
            const pid = await ns.exec(path, selectedHost, 1);
            if (pid === 0) {
                throw new Error(`Couldn't start ${path} on ${selectedHost} — enough free RAM, and root access?`);
            }
            setSelectedRunning(true);
        } catch (err) {
            setActionError(err instanceof Error ? err.message : String(err));
        } finally {
            setActionBusy(false);
        }
    }

    async function killFile(path: string) {
        setActionBusy(true);
        setActionError(null);
        try {
            await ns.kill(path, selectedHost);
            setSelectedRunning(false);
        } catch (err) {
            setActionError(err instanceof Error ? err.message : String(err));
        } finally {
            setActionBusy(false);
        }
    }

    async function tailFile(path: string) {
        await ns.ui.openTail(path, selectedHost);
    }

    function startRename(path: string) {
        setRenaming(path);
        setRenameValue(path.slice(currentPath ? currentPath.length + 1 : 0));
        setActionError(null);
    }

    async function confirmRename() {
        if (!renaming) return;
        const newName = renameValue.trim();
        if (!newName || newName.includes("/")) {
            setActionError('Enter a valid file name (no "/").');
            return;
        }
        const prefix = currentPath ? `${currentPath}/` : "";
        const destination = `${prefix}${newName}`;
        if (destination === renaming) {
            setRenaming(null);
            return;
        }
        setActionBusy(true);
        setActionError(null);
        try {
            await ns.mv(selectedHost, renaming, destination);
            setRenaming(null);
            setSelected(destination);
            await loadFiles(selectedHost);
        } catch (err) {
            setActionError(err instanceof Error ? err.message : String(err));
        } finally {
            setActionBusy(false);
        }
    }

    function handleDeleteClick(path: string) {
        if (confirmDelete === path) {
            void doDelete(path);
        } else {
            setConfirmDelete(path);
        }
    }

    async function doDelete(path: string) {
        setConfirmDelete(null);
        setActionBusy(true);
        setActionError(null);
        try {
            const ok = await ns.rm(path, selectedHost);
            if (!ok) throw new Error("Delete failed — is the file currently running?");
            if (selected === path) setSelected(null);
            await loadFiles(selectedHost);
        } catch (err) {
            setActionError(err instanceof Error ? err.message : String(err));
        } finally {
            setActionBusy(false);
        }
    }

    async function copyTo(path: string, destHost: string) {
        setCopyMenuFor(null);
        setActionBusy(true);
        setActionError(null);
        try {
            const ok = await ns.scp(path, destHost, selectedHost);
            if (!ok) throw new Error(`Copy to ${destHost} failed.`);
            notifySuccess(`Copied ${path} to ${destHost}`);
        } catch (err) {
            setActionError(err instanceof Error ? err.message : String(err));
        } finally {
            setActionBusy(false);
        }
    }

    async function createNewFile() {
        const name = newFileName.trim();
        if (!name) return;
        const prefix = currentPath ? `${currentPath}/` : "";
        const fullPath = `${prefix}${name}`;
        setActionBusy(true);
        setActionError(null);
        try {
            if (await ns.fileExists(fullPath, "home")) {
                throw new Error(`${name} already exists.`);
            }
            await ns.write(fullPath, "", "w");
            setNewFileOpen(false);
            setNewFileName("");
            await loadFiles("home");
            setSelected(fullPath);
        } catch (err) {
            setActionError(err instanceof Error ? err.message : String(err));
        } finally {
            setActionBusy(false);
        }
    }

    const buttonStyle = (danger = false) => ({
        background: danger ? theme.errorDark : theme.button,
        color: danger ? theme.error : theme.primary,
        border: `1px solid ${danger ? theme.error : theme.primary}`,
        borderRadius: "4px",
        padding: "4px 8px",
        cursor: "pointer",
        fontFamily: "inherit",
        fontSize: "11px",
        whiteSpace: "nowrap" as const,
    });

    const fieldStyle = {
        background: theme.well,
        color: theme.primary,
        border: `1px solid ${theme.primary}`,
        borderRadius: "4px",
        padding: "4px",
        fontFamily: "inherit",
        fontSize: "11px",
        width: "100%",
        boxSizing: "border-box" as const,
    };

    // --- Edit screen ---
    if (mode === "edit" && editingPath) {
        const editable = isEditable(editingPath);
        return (
            <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: "360px" }}>
                <div
                    style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: "8px",
                        marginBottom: "8px",
                        flexShrink: 0,
                    }}
                >
                    <span style={{ fontWeight: "bold", fontSize: "12px", ...wrapText }}>
                        {editingHost !== "home" ? `${editingHost}: ` : ""}
                        {iconForFile(editingPath)} {editingPath}
                        {editDirty ? " *" : ""}
                    </span>
                    <div style={{ display: "flex", gap: "6px", flexShrink: 0 }}>
                        {editable ? (
                            <button
                                onClick={() => void saveEdit()}
                                disabled={editBusy || !editDirty}
                                style={{ ...buttonStyle(), opacity: editBusy || !editDirty ? 0.6 : 1 }}
                            >
                                {editBusy ? "..." : "💾 Save"}
                            </button>
                        ) : null}
                        <button onClick={closeEditor} style={buttonStyle()}>
                            {confirmDiscardEditor ? "Discard?" : "✕ Close"}
                        </button>
                    </div>
                </div>
                {editError ? (
                    <div style={{ color: theme.error, fontSize: "11px", marginBottom: "8px", ...wrapText }}>
                        {editError}
                    </div>
                ) : null}
                {!editable ? (
                    <div style={{ fontSize: "11px", opacity: 0.75, marginBottom: "6px" }}>
                        Read-only — Bitburner doesn't support saving this file type.
                    </div>
                ) : editingHost !== "home" ? (
                    <div style={{ fontSize: "11px", opacity: 0.75, marginBottom: "6px" }}>
                        Saving pushes changes back to {editingHost}. A cached copy also lives at{" "}
                        remote/{editingHost}/{editingPath} on home.
                    </div>
                ) : null}
                <textarea
                    value={editContent}
                    readOnly={!editable}
                    spellCheck={false}
                    onChange={(ev: any) => {
                        setEditContent(ev.target.value);
                        setEditDirty(true);
                        setConfirmDiscardEditor(false);
                    }}
                    style={{
                        flex: "1 1 auto",
                        minHeight: 0,
                        resize: "none",
                        background: theme.well,
                        color: theme.primary,
                        border: `1px solid ${theme.primary}`,
                        borderRadius: "4px",
                        padding: "8px",
                        fontFamily: "Consolas, monospace",
                        fontSize: "12px",
                        whiteSpace: "pre",
                    }}
                />
            </div>
        );
    }

    // --- Browse screen ---
    const entries = computeEntries(files, currentPath).filter(
        (e) => !search || e.name.toLowerCase().includes(search.toLowerCase())
    );
    const crumbs = currentPath ? currentPath.split("/") : [];
    const hostIcon = hosts.find((h) => h.hostname === selectedHost)?.icon ?? "💻";

    return (
        <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: "380px", fontSize: "12px" }}>
            {copyMenuFor ? (
                <div onClick={() => setCopyMenuFor(null)} style={{ position: "fixed", inset: 0, zIndex: 1 }} />
            ) : null}

            {actionError ? (
                <div style={{ color: theme.error, fontSize: "11px", marginBottom: "6px", flexShrink: 0, ...wrapText }}>
                    {actionError}
                </div>
            ) : null}

            {/* Toolbar: up / breadcrumb / refresh / new file */}
            <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "6px", flexShrink: 0 }}>
                <button onClick={goUp} disabled={!currentPath} title="Up one folder" style={buttonStyle()}>
                    ⬆
                </button>
                <div style={{ flex: 1, minWidth: 0, ...wrapText }}>
                    <span
                        onClick={() => navigate("")}
                        style={{ cursor: "pointer", textDecoration: currentPath ? "underline" : "none" }}
                    >
                        {hostIcon} {selectedHost}
                    </span>
                    {crumbs.map((seg: string, i: number) => (
                        <span key={i}>
                            {" / "}
                            <span
                                onClick={() => navigate(crumbs.slice(0, i + 1).join("/"))}
                                style={{ cursor: "pointer", textDecoration: i < crumbs.length - 1 ? "underline" : "none" }}
                            >
                                {seg}
                            </span>
                        </span>
                    ))}
                </div>
                <button
                    onClick={() => void loadFiles(selectedHost)}
                    disabled={filesLoading}
                    title="Refresh this folder"
                    style={buttonStyle()}
                >
                    {filesLoading ? "..." : "⟳"}
                </button>
                <button
                    onClick={() => {
                        setNewFileOpen((v: boolean) => !v);
                        setNewFileName("");
                    }}
                    disabled={selectedHost !== "home"}
                    title={
                        selectedHost !== "home"
                            ? "New files can only be created on home (ns.write always targets home)"
                            : "New text file"
                    }
                    style={{ ...buttonStyle(), opacity: selectedHost !== "home" ? 0.5 : 1 }}
                >
                    ＋
                </button>
            </div>

            {newFileOpen ? (
                <div style={{ display: "flex", gap: "6px", marginBottom: "6px", flexShrink: 0 }}>
                    <input
                        type="text"
                        value={newFileName}
                        placeholder="notes.txt"
                        onChange={(ev: any) => setNewFileName(ev.target.value)}
                        style={fieldStyle}
                    />
                    <button onClick={() => void createNewFile()} disabled={actionBusy || !newFileName.trim()} style={buttonStyle()}>
                        Create
                    </button>
                    <button onClick={() => setNewFileOpen(false)} style={buttonStyle()}>
                        Cancel
                    </button>
                </div>
            ) : null}

            <input
                type="text"
                value={search}
                placeholder="🔎 Search this folder"
                onChange={(ev: any) => setSearch(ev.target.value)}
                style={{ ...fieldStyle, marginBottom: "6px", flexShrink: 0 }}
            />

            {/* Sidebar (hosts) + file grid */}
            <div style={{ display: "flex", flex: "1 1 auto", minHeight: 0, gap: "8px" }}>
                <div style={{ width: "104px", flexShrink: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: "2px" }}>
                    {hostsLoading ? (
                        <div style={{ opacity: 0.7, fontSize: "11px" }}>Loading…</div>
                    ) : (
                        hosts.map((h) => (
                            <button
                                key={h.hostname}
                                onClick={() => selectHost(h.hostname)}
                                title={h.hostname}
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "4px",
                                    textAlign: "left",
                                    background: h.hostname === selectedHost ? theme.button : "transparent",
                                    color: theme.primary,
                                    border: `1px solid ${h.hostname === selectedHost ? theme.primary : "transparent"}`,
                                    borderRadius: "4px",
                                    padding: "4px 6px",
                                    cursor: "pointer",
                                    fontFamily: "inherit",
                                    fontSize: "11px",
                                }}
                            >
                                <span>{h.icon}</span>
                                <span style={{ ...wrapText, flex: 1 }}>{h.hostname}</span>
                            </button>
                        ))
                    )}
                </div>

                <div
                    onClick={(ev: any) => {
                        if (ev.target === ev.currentTarget) setSelected(null);
                    }}
                    style={{
                        flex: 1,
                        minHeight: 0,
                        overflowY: "auto",
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fill, minmax(72px, 1fr))",
                        gap: "6px",
                        alignContent: "start",
                        padding: "6px",
                        border: `1px solid ${theme.primaryDark}`,
                        borderRadius: "4px",
                        background: theme.well,
                    }}
                >
                    {filesLoading ? (
                        <div style={{ gridColumn: "1 / -1", opacity: 0.7 }}>Loading…</div>
                    ) : filesError ? (
                        <div style={{ gridColumn: "1 / -1", color: theme.error, ...wrapText }}>{filesError}</div>
                    ) : entries.length === 0 ? (
                        <div style={{ gridColumn: "1 / -1", opacity: 0.7 }}>Empty folder.</div>
                    ) : (
                        entries.map((e) => (
                            <div
                                key={e.fullPath}
                                onClick={() => {
                                    if (!e.isFolder) setSelected(e.fullPath);
                                }}
                                onDoubleClick={() => handleOpenEntry(e)}
                                title={e.name}
                                style={{
                                    display: "flex",
                                    flexDirection: "column",
                                    alignItems: "center",
                                    gap: "2px",
                                    padding: "6px 2px",
                                    borderRadius: "4px",
                                    cursor: "pointer",
                                    background: selected === e.fullPath ? theme.button : "transparent",
                                    border: `1px solid ${selected === e.fullPath ? theme.primary : "transparent"}`,
                                }}
                            >
                                <span style={{ fontSize: "22px", lineHeight: 1 }}>
                                    {e.isFolder ? FOLDER_ICON : iconForFile(e.name)}
                                </span>
                                <span style={{ fontSize: "10px", textAlign: "center", ...wrapText, maxWidth: "100%" }}>
                                    {e.name}
                                </span>
                            </div>
                        ))
                    )}
                </div>
            </div>

            {/* Action bar for the selected file */}
            {selected ? (
                <div
                    style={{
                        marginTop: "6px",
                        flexShrink: 0,
                        borderTop: `1px solid ${theme.well}`,
                        paddingTop: "6px",
                    }}
                >
                    {renaming === selected ? (
                        <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                            <input
                                type="text"
                                value={renameValue}
                                onChange={(ev: any) => setRenameValue(ev.target.value)}
                                style={fieldStyle}
                            />
                            <button onClick={() => void confirmRename()} disabled={actionBusy} style={buttonStyle()}>
                                Save
                            </button>
                            <button onClick={() => setRenaming(null)} style={buttonStyle()}>
                                Cancel
                            </button>
                        </div>
                    ) : (
                        <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" as const }}>
                            <span style={{ ...wrapText, flex: "1 1 auto", fontSize: "11px", opacity: 0.85 }}>
                                {iconForFile(selected)} {selected}
                            </span>
                            <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" as const }}>
                                {canViewFile(selected, selectedHost) ? (
                                    <button
                                        onClick={() => void openViewer(selected, selectedHost)}
                                        disabled={actionBusy || editBusy}
                                        title={
                                            selectedHost !== "home"
                                                ? `Fetches a cached copy to remote/${selectedHost}/... on home`
                                                : undefined
                                        }
                                        style={buttonStyle()}
                                    >
                                        {editBusy ? "..." : "👁 View"}
                                    </button>
                                ) : isReadable(selected) ? (
                                    <button
                                        disabled
                                        title="Literature/message files can't be cached from another server — Copy to home, then view it there"
                                        style={{ ...buttonStyle(), opacity: 0.5 }}
                                    >
                                        👁 View
                                    </button>
                                ) : null}
                                {isRunnable(selected) ? (
                                    selectedRunning ? (
                                        <React.Fragment>
                                            <button
                                                onClick={() => void tailFile(selected)}
                                                disabled={actionBusy}
                                                title="Open log window"
                                                style={buttonStyle()}
                                            >
                                                📃
                                            </button>
                                            <button onClick={() => void killFile(selected)} disabled={actionBusy} style={buttonStyle(true)}>
                                                ⏹ Kill
                                            </button>
                                        </React.Fragment>
                                    ) : (
                                        <button onClick={() => void runFile(selected)} disabled={actionBusy} style={buttonStyle()}>
                                            ▶ Run
                                        </button>
                                    )
                                ) : null}
                                {isMovable(selected) ? (
                                    <button onClick={() => startRename(selected)} disabled={actionBusy} style={buttonStyle()}>
                                        ✏ Rename
                                    </button>
                                ) : null}
                                {isCopyable(selected) ? (
                                    <div
                                        style={{
                                            position: "relative",
                                            display: "flex",
                                            ...(copyMenuFor === selected ? { zIndex: 2 } : {}),
                                        }}
                                    >
                                        <button
                                            onClick={() => setCopyMenuFor(copyMenuFor === selected ? null : selected)}
                                            disabled={actionBusy || hosts.length <= 1}
                                            style={buttonStyle()}
                                        >
                                            ⧉ Copy to ▾
                                        </button>
                                        {copyMenuFor === selected ? (
                                            <div
                                                style={{
                                                    position: "absolute",
                                                    bottom: "100%",
                                                    right: 0,
                                                    marginBottom: "2px",
                                                    background: theme.well,
                                                    border: `1px solid ${theme.primary}`,
                                                    borderRadius: "4px",
                                                    boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
                                                    minWidth: "140px",
                                                    maxHeight: "160px",
                                                    overflowY: "auto",
                                                    overflowX: "hidden",
                                                }}
                                            >
                                                {hosts
                                                    .filter((h) => h.hostname !== selectedHost)
                                                    .map((h) => (
                                                        <button
                                                            key={h.hostname}
                                                            onClick={() => void copyTo(selected, h.hostname)}
                                                            style={{
                                                                display: "block",
                                                                width: "100%",
                                                                textAlign: "left",
                                                                background: "transparent",
                                                                color: theme.primary,
                                                                border: "none",
                                                                borderBottom: `1px solid ${theme.well}`,
                                                                padding: "6px 8px",
                                                                cursor: "pointer",
                                                                fontFamily: "inherit",
                                                                fontSize: "11px",
                                                            }}
                                                        >
                                                            {h.icon} {h.hostname}
                                                        </button>
                                                    ))}
                                            </div>
                                        ) : null}
                                    </div>
                                ) : null}
                                {isDeletable(selected) ? (
                                    <button onClick={() => handleDeleteClick(selected)} disabled={actionBusy} style={buttonStyle(true)}>
                                        {confirmDelete === selected ? "Confirm?" : "🗑 Delete"}
                                    </button>
                                ) : null}
                            </div>
                        </div>
                    )}
                </div>
            ) : null}

            <div style={{ fontSize: "10px", opacity: 0.6, marginTop: "4px", flexShrink: 0 }}>
                {entries.length} item{entries.length === 1 ? "" : "s"}
            </div>
        </div>
    );
}

export const FileExplorerApp: AppDefinition = {
    id: "file-explorer",
    icon: "🗂️",
    label: "Files",
    Content: FileExplorerContent,
    preferredWidth: 660,
    preferredHeight: 480,
};
