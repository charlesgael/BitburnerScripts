import type { NS } from '@ns'
import type { InferSchema, Schema } from './tiny-schema/types'
import { schema } from './tiny-schema/core'
import { number } from './tiny-schema/number'

/**
 * Wraps a content schema with a `ts` timestamp field, the same way
 * `addLog` stamps every write with `{ ts: Date.now(), ...input }`.
 *
 * Takes any `Schema<T>` rather than requiring `ObjectSchema` — in
 * particular `content` can be `or(objectA, objectB)`, a schema whose
 * output is a *union*, not a single object shape (`combine`'s
 * `ObjectSchema<A & B>` only fits when there's one shape to merge `ts`
 * into; a discriminated union of variant entries needs `ts` distributed
 * across each variant instead, which `{ ts: number } & T` does for free
 * when `T` is a union). See `contracts/state-file/types.ts` for the
 * single-shape case (`logSchema(combine(...))`) and
 * `ui/utils/money-farm-log.ts` for the union case.
 */
export function logSchema<T>(content: Schema<T>): Schema<{ ts: number } & T> {
  const tsField = number()

  return schema({
    validate(input: unknown): { ts: number } & T {
      if (
        typeof input !== 'object'
        || input === null
        || Array.isArray(input)
      ) {
        throw new TypeError('Expected object')
      }

      const ts = tsField.validate((input as Record<string, unknown>).ts)
      const rest = content.validate(input)

      return { ts, ...rest } as { ts: number } & T
    },
  })
}

let saves = 0
const AUTO_CLEAN_ROUNDS = 50
const LOG_MAX_ENTRIES = 500

export function trimLogIfNeeded(ns: NS, logFile: string, cleanDelay = AUTO_CLEAN_ROUNDS, maxEntries = LOG_MAX_ENTRIES) {
  if (saves % cleanDelay !== 0)
    return
  const raw = ns.read(logFile)
  if (!raw)
    return
  const lines = raw.split(`\n`).filter(l => l.trim())
  if (lines.length <= maxEntries)
    return
  ns.write(logFile, `${lines.slice(-maxEntries).join(`\n`)}\n`, `w`)
}
export function addLog(ns: NS, logFile: string, line: string, cleanDelay?: number, maxEntries?: number): void
export function addLog(ns: NS, logFile: string, input: any, cleanDelay?: number, maxEntries?: number): void
export function addLog(ns: NS, logFile: string, input: any, cleanDelay = AUTO_CLEAN_ROUNDS, maxEntries = LOG_MAX_ENTRIES) {
  if (typeof input === 'object') {
    ns.write(logFile, `${JSON.stringify({ ts: Date.now(), ...input })}\n`, `a`)
  }
  else {
    ns.write(logFile, `${Date.now()} ${input}\n`, `a`)
  }
  saves++
  trimLogIfNeeded(ns, logFile, cleanDelay, maxEntries)
}

export function parseLog<Data, T extends Schema<Data>>(raw: string, schema: T): InferSchema<T>[]
export function parseLog(raw: string): unknown[]
export function parseLog(raw: string, schema?: any): any {
  if (!raw)
    return []
  const entries: unknown[] = []
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed)
      continue
    try {
      if (schema)
        entries.push(schema.parse(trimmed)!)
      else
        entries.push(JSON.parse(trimmed))
    }
    catch {
      // Skip a corrupt/partial line (e.g. a write cut short by a crash)
      // rather than discarding every entry around it.
    }
  }
  return entries
}
