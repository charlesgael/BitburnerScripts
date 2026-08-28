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
  let el = doc.getElementById(id)
  if (!el) {
    el = doc.createElement('style')
    el.id = id
    doc.head.appendChild(el)
  }
  return el
}
