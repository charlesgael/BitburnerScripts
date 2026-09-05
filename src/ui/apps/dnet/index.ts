import type { AppAvailabilityContext, AppDefinition } from '../../types'
import { TorExplorer } from './components/tor-explorer'

export const DNetFS: AppDefinition = {
  id: 'dnet-fs',
  icon: '🖧',
  label: 'DNetFS',
  Content: TorExplorer,
  isAvailable({ darkscapeNavigator }: Pick<AppAvailabilityContext, 'darkscapeNavigator'>) {
    return darkscapeNavigator || 'Needs TOR Router'
  },
  unmanaged: true,
  preferredWidth: 180 + 180 + 320,
  preferredHeight: 400,
  minWidth: 180 + 180 + 320,
  minHeight: 400,
}
