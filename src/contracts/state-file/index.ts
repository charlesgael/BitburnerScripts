import type { NS } from '@ns'
import type { Contract, SolveResult } from '../../contracts.lib'
import type { ContractsLogEntry } from './types'
import { addLog, parseLog } from '../../utils/log-helper'

import { contractsLogEntrySchema } from './types'

export const CONTRACTS_LOG_FILE = 'log/contracts-log.txt'
export const CONTRACTS_SCRIPT = 'contracts.app.js'
export const CONTRACTS_HOST = 'home'

export function recordContractResult(ns: NS, result: SolveResult, contract: Contract) {
  addLog(ns, CONTRACTS_LOG_FILE, { ...result, ...contract })
}

export function parseContractLog(raw: string): ContractsLogEntry[] {
  return parseLog(raw, contractsLogEntrySchema)
}
