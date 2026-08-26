import { theme, wrapText } from "../../../utils/theme";
import { FOLDER_ICON, iconForFile } from "../../../utils/file-types";
import { FileExplorerState } from "../logic/use-file-explorer";

/** The folder/file grid for the current host + path. */
export function FileGrid({ React, fx }: { React: any; fx: FileExplorerState }) {
    return (
        <div
            onClick={(ev: any) => {
                if (ev.target === ev.currentTarget) fx.setSelected(null);
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
            {fx.filesLoading ? (
                <div style={{ gridColumn: "1 / -1", opacity: 0.7 }}>Loading…</div>
            ) : fx.filesError ? (
                <div style={{ gridColumn: "1 / -1", color: theme.error, ...wrapText }}>{fx.filesError}</div>
            ) : fx.entries.length === 0 ? (
                <div style={{ gridColumn: "1 / -1", opacity: 0.7 }}>Empty folder.</div>
            ) : (
                fx.entries.map((e) => (
                    <div
                        key={e.fullPath}
                        onClick={() => {
                            if (!e.isFolder) fx.setSelected(e.fullPath);
                        }}
                        onDoubleClick={() => fx.handleOpenEntry(e)}
                        title={e.name}
                        style={{
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            gap: "2px",
                            padding: "6px 2px",
                            borderRadius: "4px",
                            cursor: "pointer",
                            background: fx.selected === e.fullPath ? theme.button : "transparent",
                            border: `1px solid ${fx.selected === e.fullPath ? theme.primary : "transparent"}`,
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
    );
}
