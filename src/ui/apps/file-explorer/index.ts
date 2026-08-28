import type { AppDefinition } from '../../types'
import { FileExplorerContent } from './components/file-explorer-content'

/**
 * A small Windows-Explorer-flavored file browser: a left-hand list of
 * "drives" (`home`, purchased/cloud servers, and any host previously found
 * by Netmapper — see `ui/utils/network-hosts.ts`), a folder/file grid with
 * unicode icons (Bitburner has no real directories, so a "folder" here is
 * just a common "/"-prefix shared by several filenames — see
 * `logic/compute-entries.ts`), and a per-file action bar (View/Edit, Run/
 * Kill/Tail, Rename, Copy to another host, Delete). Built for players who'd
 * rather click around than type terminal commands.
 *
 * Every file op here goes through the queued `ns` (see `ns-proxy.ts`)
 * exactly like every other app — no dedicated daemon needed, since
 * `ls`/`read`/`write`/`rm`/`mv`/`scp` together only add about 1.4 GB to
 * `ui.app.js`'s footprint (`getScriptRam`/`exec`/`kill`/`isRunning`/
 * `ui.openTail` are already paid for by the Programs/Trainer apps' task
 * manager — see `../task-manager/`), well under what a dedicated daemon
 * round-trip would cost in complexity for something this cheap.
 *
 * See `ui/utils/file-types.ts`'s header comment for the (real, not
 * arbitrary) per-extension capability rules this app enforces — most
 * importantly that View/Edit only ever works while browsing `home`, since
 * `ns.read`/`ns.write` have no host parameter and always target the
 * calling script's own server.
 *
 * All state/behavior lives in `logic/use-file-explorer.ts`; `components/`
 * is plain presentational JSX driven off that hook's return value.
 */
export const FileExplorerApp: AppDefinition = {
  id: 'file-explorer',
  icon: '🗂️',
  label: 'Files',
  Content: FileExplorerContent,
  preferredWidth: 900,
  preferredHeight: 600,
  // Floor wide enough for the host sidebar (154px) plus a usable file
  // grid beside it — below this the grid gets squeezed to nothing before
  // the sidebar does. See `minWidth`/`minHeight` on `AppDefinition`.
  minWidth: 650,
  minHeight: 500,
}
