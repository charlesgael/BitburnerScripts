/**
 * Creates (if missing) a `<style>` element with a fixed `id` in `<head>`,
 * and returns it so the caller can set/replace its content.
 *
 * Idempotent and safe to re-run: an existing element with the same id is
 * reused as-is rather than creating a duplicate, so re-running the script
 * that calls this (e.g. after editing a style chunk) just updates the
 * live styling instead of accumulating orphaned `<style>` tags.
 */
export function ensureStyleElement(doc: any, id: string): any {
    let el = doc.getElementById(id);
    if (!el) {
        el = doc.createElement("style");
        el.id = id;
        doc.head.appendChild(el);
    }
    return el;
}

/**
 * Runs `source` as a real `<script>` tag in `<head>`, once per distinct
 * `id`.
 *
 * Unlike `ensureStyleElement`, this can't just reuse-and-update an existing
 * element: per the HTML spec, mutating an already-inserted `<script>`'s
 * `textContent` does not re-run it — only *inserting* a freshly created
 * script element executes it. So instead of reusing, any previous element
 * with this `id` is removed and a brand new one is created and appended in
 * its place, forcing the code to actually (re-)run. Still idempotent in
 * effect: `source` is expected to be a self-contained library whose global
 * assignment (e.g. `var Notyf = ...`) is deterministic, so re-running it —
 * e.g. after editing the vendored copy — just redefines the same global
 * again rather than accumulating anything.
 */
export function runScriptOnce(doc: any, id: string, source: string): void {
    const existing = doc.getElementById(id);
    if (existing) existing.remove();

    const el = doc.createElement("script");
    el.id = id;
    el.textContent = source;
    doc.head.appendChild(el);
}
