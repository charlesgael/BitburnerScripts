import type { AppComponentProps } from '../../../types'
import { useCgdActions } from '../../../context/cgd-actions-context'
import { useAddChildPid } from '../../../context/child-pids-context'
import { useQueuedNs } from '../../../context/ns-queue-context'
import { useFileExplorer } from '../logic/use-file-explorer'
import { BrowseScreen } from './browse-screen'
import { EditScreen } from './edit-screen'

/**
 * Root component: wires up `useFileExplorer` and switches between the
 * browse and edit screens. See `../index.ts`'s header comment for what
 * this app does and why.
 */
export function FileExplorerContent({ React }: AppComponentProps) {
  const ns = useQueuedNs()
  const addChildPid = useAddChildPid()
  const callAction = useCgdActions()
  const fx = useFileExplorer(React, ns, addChildPid, callAction)

  if (fx.mode === 'edit' && fx.editingPath) {
    return <EditScreen React={React} fx={fx} />
  }
  return <BrowseScreen React={React} fx={fx} />
}
