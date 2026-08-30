import type { AppDefinition } from '../../types'
import { ContractsBrowse } from './components/contracts-dashboardard'

export const ContractsApp: AppDefinition = {
  id: 'contracts',
  icon: '📄',
  label: 'Contracts',
  Content: ContractsBrowse,
  preferredWidth: 900,
  preferredHeight: 600,
  unmanaged: true,
}
