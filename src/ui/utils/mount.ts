/**
 * Resolves once `doc.getElementById(id)` finds something, polling instead
 * of assuming it's already there. The sidebar/overview hooks this UI mounts
 * into are painted by the game's own React tree, which isn't guaranteed to
 * have rendered them yet the instant this script starts running — without
 * this, `mountContainer` could try to `appendChild` onto `null` on a slow
 * load and crash on startup.
 *
 * Plain `setTimeout` polling, not `ns.sleep` — this isn't an ns.* call, so
 * it doesn't need to go through the queue (see `ns-queue.ts`) and costs no
 * RAM either way.
 */
export function waitForElement(doc: any, id: string, timeoutMs = 10000, intervalMs = 50): Promise<any> {
    return new Promise((resolve, reject) => {
        const start = Date.now();
        function check() {
            const el = doc.getElementById(id);
            if (el) {
                resolve(el);
                return;
            }
            if (Date.now() - start >= timeoutMs) {
                reject(new Error(`waitForElement: #${id} never appeared within ${timeoutMs}ms`));
                return;
            }
            setTimeout(check, intervalMs);
        }
        check();
    });
}

/**
 * Creates a fresh container div with a fixed `containerId`, appended to
 * `parentId` (waiting for it to exist first — see `waitForElement`). Fixed
 * (not tied to pid) so that if a previous run of this exact script was
 * force-killed and left its node behind, this finds and removes it first
 * instead of accumulating orphans on every restart.
 */
export async function mountContainer(doc: any, parentId: string, containerId: string): Promise<any> {
    const orphan = doc.getElementById(containerId);
    if (orphan && orphan.parentNode) {
        orphan.parentNode.removeChild(orphan);
    }

    const container = doc.createElement("div");
    container.id = containerId;

    const parent = await waitForElement(doc, parentId);
    parent.appendChild(container);

    return container;
}

/**
 * Re-attaches `container` under `parentId` if the game's own React tree
 * ever tore down and rebuilt the hook it was mounted in — e.g. switching
 * into/out of Focus on a task can replace `#sidebar-extra-hook-*` with a
 * fresh element, silently detaching (not destroying) whatever was appended
 * to the old one. The script keeps running and reserving its RAM either
 * way — the UI just goes invisible instead of actually stopping — so
 * without this the only fix is a manual restart.
 *
 * Cheap to call every idle tick: `.isConnected` is a plain property read,
 * not a DOM query, so this only does real work on the rare tick it's
 * actually needed. Doesn't touch React at all — `container` still holds
 * its live React tree the whole time it's detached, so simply re-appending
 * the same node is enough to make it visible again, no re-render needed.
 */
export function reattachIfDetached(doc: any, container: any, parentId: string): void {
    if (!container || container.isConnected) return;
    const parent = doc.getElementById(parentId);
    if (parent) parent.appendChild(container);
}

/**
 * Starts a plain `setInterval` (not `ns.sleep` — this isn't an ns.* call,
 * costs nothing, and keeps firing via the browser's own event loop
 * regardless of whether the script that started it is still "running" from
 * Bitburner's perspective) that periodically calls `reattachIfDetached` for
 * `container`. Replaces what used to be one branch of `ui.app.ts`'s own
 * main loop, back when there was one — see `docs/epic-cgd-namespace.md`
 * section 3: nothing here touches `ns`, so it never needed the daemon's
 * queue in the first place, just something to keep calling it periodically
 * now that there's no loop doing that as a side effect of draining a queue.
 *
 * Returns a stop function — call it as part of the same teardown that
 * unmounts `container` (see `ui.app.ts`'s `cgd.reactApps` handles), or this
 * would keep firing after an intentional `unmountContainer` removes
 * `container` from the DOM and start "detecting" that removal as damage to
 * repair, re-attaching a container that was deliberately torn down.
 */
export function startReattachGuardian(doc: any, container: any, parentId: string, intervalMs = 1000): () => void {
    const id = setInterval(() => reattachIfDetached(doc, container, parentId), intervalMs);
    return () => clearInterval(id);
}

/**
 * Unmounts the React tree in `container` (if any) and removes it from the
 * DOM. Safe to call multiple times or on an already-detached container.
 */
export function unmountContainer(ReactDOM: any, container: any): void {
    if (!container) return;
    try {
        ReactDOM.unmountComponentAtNode(container);
    } catch (e) {
        // no-op if already unmounted
    }
    if (container.parentNode) {
        container.parentNode.removeChild(container);
    }
}
