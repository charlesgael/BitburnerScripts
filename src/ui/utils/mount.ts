/**
 * Creates a fresh container div with a fixed `containerId`, appended to
 * `parentId`. Fixed (not tied to pid) so that if a previous run of this
 * exact script was force-killed and left its node behind, this finds and
 * removes it first instead of accumulating orphans on every restart.
 */
export function mountContainer(doc: any, parentId: string, containerId: string): any {
    const orphan = doc.getElementById(containerId);
    if (orphan && orphan.parentNode) {
        orphan.parentNode.removeChild(orphan);
    }

    const container = doc.createElement("div");
    container.id = containerId;

    const parent = doc.getElementById(parentId);
    parent.appendChild(container);

    return container;
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
