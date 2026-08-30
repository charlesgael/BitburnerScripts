import type { NS } from '@ns'
import type { InferSchema, ObjectSchema, Schema, Shape } from './tiny-schema/types'
import { combine } from './tiny-schema/combine'
import { number } from './tiny-schema/number'
import { object } from './tiny-schema/object'

export function logSchema<S extends Shape>(content: ObjectSchema<S>) {
  return combine(object({
    ts: number(),
  }), content)
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
