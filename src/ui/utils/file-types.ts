/**
 * Per-extension unicode icon + capability rules for the File Explorer app
 * (`ui/apps/file-explorer/`). The capability predicates encode real
 * Netscript API restrictions — see each function's doc comment in
 * `NetscriptDefinitions.d.ts` — not arbitrary UI choices:
 *   - `ns.read`/`ns.write` take NO host parameter at all: they always
 *     operate on the calling script's own server, which for this app
 *     (bundled into `ui.app.js`, always running on `home`) means they only
 *     ever touch files on `home` — never whichever host the player is
 *     currently browsing. That's why the app only ever offers View/Edit
 *     while browsing `home`; seeing a file that lives elsewhere means
 *     copying it to `home` first (the "Copy to" action), same as a real
 *     player would have to `scp` it over in the terminal.
 *   - `ns.mv` ("only works for scripts (.js, .jsx, .ts, .tsx) and text
 *     files (.txt, .json, .css)") gates Rename.
 *   - `ns.scp` ("Copies text, script or literature (.lit) file(s)") gates
 *     Copy-to — one wider than `mv` (adds .lit), but still excludes
 *     .msg/.exe/.cct.
 *   - `ns.rm` ("works for every file type except message (.msg) files")
 *     gates Delete.
 */

const ICONS_BY_EXTENSION: Record<string, string> = {
    js: "📜",
    jsx: "📜",
    ts: "📜",
    tsx: "📜",
    txt: "📄",
    json: "🧾",
    css: "🎨",
    lit: "📖",
    msg: "✉️",
    exe: "⚙️",
    cct: "🧩",
};

export const FOLDER_ICON = "📁";
export const DEFAULT_FILE_ICON = "📦";

/** Extension of `name` (no leading dot), lowercased — "" if it has none.
 * Works on a full `ns.ls()`-style path (e.g. "daemons/foo.js") since it
 * only ever looks at the last "/" segment. */
export function extensionOf(name: string): string {
    const base = name.slice(name.lastIndexOf("/") + 1);
    const dot = base.lastIndexOf(".");
    return dot <= 0 ? "" : base.slice(dot + 1).toLowerCase();
}

/** The icon to show for a *file* row — folders are handled separately by
 * the caller (see `FOLDER_ICON`), since Bitburner has no real directory
 * entries: a "folder" is just a common "/"-prefix shared by several
 * filenames, inferred client-side rather than something `ns.ls` reports on
 * its own. Falls back to `DEFAULT_FILE_ICON` for any extension not listed
 * above, so an unrecognized file type still renders as *something*. */
export function iconForFile(name: string): string {
    return ICONS_BY_EXTENSION[extensionOf(name)] ?? DEFAULT_FILE_ICON;
}

const READABLE = new Set(["txt", "json", "css", "js", "jsx", "ts", "tsx", "lit", "msg"]);
const WRITABLE = new Set(["txt", "json", "css", "js", "jsx", "ts", "tsx"]);
const COPYABLE = new Set(["txt", "json", "css", "js", "jsx", "ts", "tsx", "lit"]);
const RUNNABLE = new Set(["js", "jsx", "ts", "tsx"]);

/** Whether `ns.read` supports this file — i.e. View is meaningful at all
 * (still only actually usable while browsing `home`, see the module doc
 * comment). */
export function isReadable(name: string): boolean {
    return READABLE.has(extensionOf(name));
}
/** Whether `ns.write` (Save, in the View/Edit screen) supports this file. */
export function isEditable(name: string): boolean {
    return WRITABLE.has(extensionOf(name));
}
/** Whether `ns.mv` (Rename) supports this file — same set as `isEditable`,
 * kept as its own named predicate since the two happen to coincide only
 * because both real APIs restrict to the same "script or text file" set. */
export function isMovable(name: string): boolean {
    return WRITABLE.has(extensionOf(name));
}
/** Whether `ns.scp` (Copy to) supports this file. */
export function isCopyable(name: string): boolean {
    return COPYABLE.has(extensionOf(name));
}
/** Whether this file is something `ns.exec` can run. */
export function isRunnable(name: string): boolean {
    return RUNNABLE.has(extensionOf(name));
}
/** Whether `ns.rm` (Delete) supports this file — everything except .msg. */
export function isDeletable(name: string): boolean {
    return extensionOf(name) !== "msg";
}
