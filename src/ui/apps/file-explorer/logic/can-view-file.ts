import { isMovable, isReadable } from '../../../utils/file-types'

/**
 * Whether View is actually offered for `name` while browsing `host`.
 * Local (`home`) files just need to be readable at all; a file on another
 * host additionally needs to be `isMovable` — the remote View/Edit cache
 * bounce (`ui/utils/remote-file-bounce.ts`) relies on `ns.mv`, which (unlike
 * `ns.scp`) doesn't support .lit/.msg.
 */
export function canViewFile(name: string, host: string): boolean {
  return isReadable(name) && (host === 'home' || isMovable(name))
}
