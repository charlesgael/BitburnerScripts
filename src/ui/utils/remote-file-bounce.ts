import { QueuedNS } from "./ns-proxy";
import { isMovable } from "./file-types";

/**
 * Lets the File Explorer app (`ui/apps/file-explorer.tsx`) View/Edit a file
 * that lives on a server other than `home`, despite `ns.read`/`ns.write`
 * having no host parameter at all — they only ever touch the calling
 * script's own server (`home`, since `ui.app.ts` always runs there — see
 * `ui/utils/file-types.ts`'s header comment for the fuller explanation).
 *
 * Only works for files `ns.mv` supports (`isMovable` — scripts and .txt/
 * .json/.css, NOT .lit/.msg/.exe/.cct), even though `ns.scp` itself has a
 * wider reach (it also accepts .lit — see `isCopyable`): the cache-slot
 * bounce below needs `ns.mv` to relocate the file into its namespaced slot,
 * and the collision-restore needs `ns.write`, and *neither* of those
 * supports .lit. (This was a real bug once: viewing a remote .lit file
 * whose name happened to collide with an existing one on `home` threw
 * "write: File path should be a text file or script" from the restore
 * step — see the git history on this file.) Callers must gate the UI with
 * `isMovable` themselves; `pullRemoteFile`/`pushRemoteFile` also throw a
 * clear error up front if asked to handle a non-movable file, as a
 * backstop rather than the primary guard.
 *
 * The trick: every file this app has ever pulled from another host ends up
 * cached at a fixed, namespaced path on `home` — `remote/<host>/<original
 * path>`, e.g. a `folder/file.txt` pulled from `n00dles` lands at
 * `remote/n00dles/folder/file.txt`. That's a perfectly ordinary file once
 * it's there — the player can browse straight to it in the Explorer like
 * any other — so no extra bookkeeping is needed to show it; `ns.ls("home")`
 * just finds it. Editing *that* cached copy directly (i.e. opening it via
 * `home`'s own listing rather than the origin host's) only ever saves
 * locally to `home` — only View/Edit invoked from the originating host's
 * own listing round-trips changes back to it (via `pushRemoteFile`).
 *
 * Why the bounce through `home`'s *real* matching path is needed at all:
 * `ns.scp` can only ever land a file at the exact same relative path on the
 * destination that it had on the source — there's no "copy as a different
 * name". So getting a file into (or out of) its namespaced cache slot means
 * momentarily landing it at that real path on `home` and then moving it
 * (`ns.mv`, 0 GB, already referenced by this app's Rename action) into or
 * out of the cache slot. If the player already has an unrelated file at
 * that exact path on `home`, the bounce would otherwise clobber it —
 * `withHomeBounce` backs that file up first and restores it (or removes the
 * transient copy, if there was nothing to restore) once the bounce is done,
 * so this is invisible in either case.
 */
const STAGING_ROOT = "remote";

export function stagedPathFor(host: string, path: string): string {
    return `${STAGING_ROOT}/${host}/${path}`;
}

async function withHomeBounce<T>(ns: QueuedNS, path: string, action: () => Promise<T>): Promise<T> {
    const collided = await ns.fileExists(path, "home");
    const backup = collided ? await ns.read(path) : null;
    try {
        return await action();
    } finally {
        if (collided) {
            await ns.write(path, backup ?? "", "w");
        } else if (await ns.fileExists(path, "home")) {
            await ns.rm(path, "home");
        }
    }
}

/** Pulls `path` from `host` into its cache slot on `home` and returns its
 * content. Safe to call repeatedly — each call re-fetches the latest
 * remote content and overwrites whatever was cached before. Throws
 * up front for a file type `ns.mv` doesn't support (see the module doc
 * comment) — callers should avoid offering this for such files at all. */
export async function pullRemoteFile(ns: QueuedNS, host: string, path: string): Promise<string> {
    if (!isMovable(path)) {
        throw new Error(`Can't preview ${path} from another server — copy it to home first, then view it there.`);
    }
    const staged = stagedPathFor(host, path);
    await withHomeBounce(ns, path, async () => {
        const ok = await ns.scp(path, "home", host);
        if (!ok) throw new Error(`Couldn't copy ${path} from ${host} — does it still exist?`);
        if (await ns.fileExists(staged, "home")) {
            await ns.rm(staged, "home");
        }
        await ns.mv("home", path, staged);
    });
    return await ns.read(staged);
}

/** Pushes `content` back to `path` on `host`, and refreshes the cache slot
 * to match so a subsequent View doesn't show stale content. Same
 * `isMovable`-only restriction as `pullRemoteFile` — moot in practice since
 * a non-movable file was never editable to begin with (see `isEditable`),
 * but kept as the same defensive backstop. */
export async function pushRemoteFile(ns: QueuedNS, host: string, path: string, content: string): Promise<void> {
    if (!isMovable(path)) {
        throw new Error(`Can't save ${path} back to another server.`);
    }
    await withHomeBounce(ns, path, async () => {
        await ns.write(path, content, "w");
        const ok = await ns.scp(path, host, "home");
        if (!ok) throw new Error(`Couldn't copy ${path} to ${host}.`);
    });
    await ns.write(stagedPathFor(host, path), content, "w");
}
