import { Entry } from "./types";

/** Splits `files` (a flat `ns.ls()` result) into the folders and files that
 * appear directly under `currentPath` — the same "one level at a time"
 * navigation a real file explorer gives you, built entirely client-side
 * since Bitburner itself only ever returns a flat list of full paths. */
export function computeEntries(files: string[], currentPath: string): Entry[] {
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
