import type { NS, ScriptArg } from '@ns'

type Value = string | number | boolean | string[]

export interface BitburnerFlagSpec {
  short?: string
  long: string
  defaultValue: Value // Native default overrides type functions
  description: string
}

export function arg(long: string, defaultValue: Value, description: string, short?: string) {
  return { long, defaultValue, description, short } as const
}

type Expand<T> = { [K in keyof T]: T[K] } & {}
type MapPrimitive<T> = T extends boolean
  ? boolean
  : T extends number
    ? number
    : T extends string[] | readonly string[]
      ? string[]
      : T extends string
        ? string
        : ScriptArg

interface ExtraArg {
  name: string
  description: string
  optional?: boolean
}

export type ParsedFlags<T extends readonly BitburnerFlagSpec[], U extends readonly ExtraArg[]> = Expand<
  {
    [K in T[number] as K['long']]: MapPrimitive<K['defaultValue']>;
  } & {
    [L in U[number] as L['name']]: ScriptArg;
  } & {
    _: ScriptArg[]
  }
>

function parseArgsHelp<T extends readonly BitburnerFlagSpec[]>(
  ns: NS,
  customSchema: T,
  extraArgs: readonly ExtraArg[] = [],
): void {
  // Evaluate if help requested: -h, --h, --help, or -help
  const helpTextRows: string[] = []

  // Add help text row for the automatically injected help flags
  helpTextRows.push(`${`  -h, --help`.padEnd(30)}Show this help menu`)

  for (const item of customSchema) {
    let typeLabel = ''
    if (typeof item.defaultValue === 'string')
      typeLabel = ' <string>'
    if (typeof item.defaultValue === 'number')
      typeLabel = ' <number>'
    if (Array.isArray(item.defaultValue))
      typeLabel = ' <array>'
    helpTextRows.push(
      `${`  ${item.short ? `-${item.short}, ` : ''}--${item.long}${typeLabel}`.padEnd(30)
      }${item.description}`,
    )
  }

  let extraArgsStr = ''
  let optionals = 0
  for (const arg of extraArgs) {
    extraArgsStr += `${(arg.optional ? '[' : '')}${arg.name}`
    if (arg.optional)
      optionals++

    helpTextRows.push(
      `${`  ${arg.name}`.padEnd(30)
      }${arg.description}`,
    )
  }
  extraArgsStr += [...Array.from({ length: optionals }).fill('')].join(']')

  ns.tprint(
    `
Usage: run ${ns.getScriptName()} [options] ${extraArgsStr}

Options:
${helpTextRows.join('\n')}`,
  )
  ns.exit()
}

/**
 * Custom Bitburner flags parser that formats a dynamic help menu and leverages ns.flags().
 * Exits the script cleanly using ns.exit() if help is triggered or if flags fail.
 */
export function parseArgs<T extends readonly BitburnerFlagSpec[], U extends readonly ExtraArg[]>(
  ns: NS,
  customSchema: T,
  extraArgs: U = [] as any,
): ParsedFlags<T, U> {
  if (ns.args.includes('-h') || ns.args.includes('--help')) {
    parseArgsHelp(ns, customSchema, extraArgs)
  }

  // Bitburner expects a native schema array of tuples: [["flagName", defaultValue]]
  const nsSchema: [string, Value][] = []

  for (const item of customSchema) {
    // Bitburner maps options directly, but you can explicitly accept both long and short variants
    nsSchema.push([item.long, item.defaultValue])
    if (item.short)
      nsSchema.push([item.short, item.defaultValue])
  }

  // Inject the native global help key triggers into the target schema
  nsSchema.push(['help', false])
  nsSchema.push(['h', false])

  // Execute the game's native engine parser
  const flags = ns.flags(nsSchema)
  const firstOpt = extraArgs.findIndex(it => it.optional === true)
  const minExtra = firstOpt === -1 ? extraArgs.length : firstOpt

  if (Array.isArray(flags._) && flags._.length < minExtra) {
    parseArgsHelp(ns, customSchema, extraArgs)
  }

  // RECONCILIATION STEP:
  // Look at every flag pair. If one was modified from the default, sync them both!
  for (const item of customSchema) {
    if (item.short) {
      const longValue = flags[item.long]
      const shortValue = flags[item.short]

      // If either value does not match the original default fallback,
      // it means the user modified it in the terminal.
      if (JSON.stringify(longValue) !== JSON.stringify(item.defaultValue)) {
        flags[item.short] = longValue
      }
      else if (
        JSON.stringify(shortValue) !== JSON.stringify(item.defaultValue)
      ) {
        flags[item.long] = shortValue
      }
    }
  }

  for (const [idx, arg] of extraArgs.entries()) {
    flags[arg.name] = (flags._ as any)[idx]
  }

  return flags as any
}
