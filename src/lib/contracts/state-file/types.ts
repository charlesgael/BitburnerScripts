import type { InferSchema } from '../../../utils/tiny-schema/types'
import { logSchema } from '../../../utils/log-helper'
import { any } from '../../../utils/tiny-schema/any'
import { boolean } from '../../../utils/tiny-schema/boolean'
import { combine } from '../../../utils/tiny-schema/combine'
import { object } from '../../../utils/tiny-schema/object'
import { string } from '../../../utils/tiny-schema/string'

export const contractSchema = object({
  title: string(),
  filename: string(),
  host: string(),
})
export type ContractData = InferSchema<typeof contractSchema>
export class Contract implements ContractData {
  constructor(
    public title: string,
    public filename: string,
    public host: string,
  ) {}
}

export const solveResultSchema = object({
  solved: boolean(),
  data: any(),
  answer: any(),
  reward: string().optional(),
  // Set instead of `reward` when ContractSolver.solve() caught an exception
  // (e.g. ns.codingcontract.attempt() rejecting a malformed answer) rather
  // than getting a legitimate empty-string "wrong answer" response.
  error: string().optional(),
})
export type SolveResultData = InferSchema<typeof solveResultSchema>
export class SolveResult implements SolveResultData {
  constructor(
    public solved: boolean,
    public data: any,
    public answer: any,
    public reward?: string,
    public error?: string,
  ) {
  }
}

export const contractsLogEntrySchema = logSchema(combine(
  solveResultSchema,
  contractSchema,
))
export type ContractsLogEntry = InferSchema<typeof contractsLogEntrySchema>
