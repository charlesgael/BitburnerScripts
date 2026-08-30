import type { AppDefinition } from '../../types'
import { ContractsDashboard } from './components/contracts-dashboard'

export const ContractsApp: AppDefinition = {
  id: 'contracts',
  icon: '📄',
  label: 'Contracts',
  Content: ContractsDashboard,
  preferredWidth: 1200,
  preferredHeight: 700,
}
