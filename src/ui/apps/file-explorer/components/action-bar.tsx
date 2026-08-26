import { theme, wrapText } from "../../../utils/theme";
import { iconForFile, isReadable, isMovable, isCopyable, isRunnable, isDeletable } from "../../../utils/file-types";
import { FileExplorerState } from "../logic/use-file-explorer";
import { buttonStyle, fieldStyle } from "../logic/styles";
import { canViewFile } from "../logic/can-view-file";

/** The action bar for the currently-selected file: View/Edit, Run/Kill/
 * Tail, Rename, Copy to another host, Delete — each offered only when the
 * selected file's extension actually supports it (see
 * `ui/utils/file-types.ts`). */
export function ActionBar({ React, fx }: { React: any; fx: FileExplorerState }) {
    if (!fx.selected) return null;
    const selected = fx.selected;

    return (
        <div
            style={{
                marginTop: "6px",
                flexShrink: 0,
                borderTop: `1px solid ${theme.well}`,
                paddingTop: "6px",
            }}
        >
            {fx.renaming === selected ? (
                <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                    <input
                        type="text"
                        value={fx.renameValue}
                        onChange={(ev: any) => fx.setRenameValue(ev.target.value)}
                        style={fieldStyle}
                    />
                    <button onClick={() => void fx.confirmRename()} disabled={fx.actionBusy} style={buttonStyle()}>
                        Save
                    </button>
                    <button onClick={() => fx.setRenaming(null)} style={buttonStyle()}>
                        Cancel
                    </button>
                </div>
            ) : (
                <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" as const }}>
                    <span style={{ ...wrapText, flex: "1 1 auto", fontSize: "11px", opacity: 0.85 }}>
                        {iconForFile(selected)} {selected}
                    </span>
                    <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" as const }}>
                        {canViewFile(selected, fx.selectedHost) ? (
                            <button
                                onClick={() => void fx.openViewer(selected, fx.selectedHost)}
                                disabled={fx.actionBusy || fx.editBusy}
                                title={
                                    fx.selectedHost !== "home"
                                        ? `Fetches a cached copy to remote/${fx.selectedHost}/... on home`
                                        : undefined
                                }
                                style={buttonStyle()}
                            >
                                {fx.editBusy ? "..." : "👁 View"}
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
                            fx.selectedRunning ? (
                                <React.Fragment>
                                    <button
                                        onClick={() => void fx.tailFile(selected)}
                                        disabled={fx.actionBusy}
                                        title="Open log window"
                                        style={buttonStyle()}
                                    >
                                        📃
                                    </button>
                                    <button onClick={() => void fx.killFile(selected)} disabled={fx.actionBusy} style={buttonStyle(true)}>
                                        ⏹ Kill
                                    </button>
                                </React.Fragment>
                            ) : (
                                <button onClick={() => void fx.runFile(selected)} disabled={fx.actionBusy} style={buttonStyle()}>
                                    ▶ Run
                                </button>
                            )
                        ) : null}
                        {isMovable(selected) ? (
                            <button onClick={() => fx.startRename(selected)} disabled={fx.actionBusy} style={buttonStyle()}>
                                ✏ Rename
                            </button>
                        ) : null}
                        {isCopyable(selected) ? (
                            <div
                                style={{
                                    position: "relative",
                                    display: "flex",
                                    ...(fx.copyMenuFor === selected ? { zIndex: 2 } : {}),
                                }}
                            >
                                <button
                                    onClick={() => fx.setCopyMenuFor(fx.copyMenuFor === selected ? null : selected)}
                                    disabled={fx.actionBusy || fx.hosts.length <= 1}
                                    style={buttonStyle()}
                                >
                                    ⧉ Copy to ▾
                                </button>
                                {fx.copyMenuFor === selected ? (
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
                                        {fx.hosts
                                            .filter((h) => h.hostname !== fx.selectedHost)
                                            .map((h) => (
                                                <button
                                                    key={h.hostname}
                                                    onClick={() => void fx.copyTo(selected, h.hostname)}
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
                            <button onClick={() => fx.handleDeleteClick(selected)} disabled={fx.actionBusy} style={buttonStyle(true)}>
                                {fx.confirmDelete === selected ? "Confirm?" : "🗑 Delete"}
                            </button>
                        ) : null}
                    </div>
                </div>
            )}
        </div>
    );
}
