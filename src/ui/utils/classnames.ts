export type Value = string | boolean | undefined | null
export type Mapping = Record<string, any>
export interface ArgumentArray extends Array<Argument> {}
export interface ReadonlyArgumentArray extends ReadonlyArray<Argument> {}
export type Argument = Value | Mapping | ArgumentArray | ReadonlyArgumentArray

const hasOwn = {}.hasOwnProperty

/**
 * Joins its arguments into one space-separated class-name string — the
 * classic `classnames`-library API (vendored here, no runtime dependency):
 * falsy args are skipped, strings are used as-is, arrays are flattened
 * recursively, and plain objects contribute each key whose value is truthy
 * (e.g. `classNames('btn', { active: isActive })`).
 */
export function classNames(...args: ArgumentArray): string {
  let classes = ''

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg) {
      classes = appendClass(classes, parseValue(arg))
    }
  }

  return classes
}
function parseValue(arg: Argument): string {
  if (typeof arg === 'string') {
    return arg
  }

  if (typeof arg !== 'object') {
    return ''
  }

  if (Array.isArray(arg)) {
    return classNames(...arg)
  }

  if (arg && arg.toString !== Object.prototype.toString && !arg.toString.toString().includes('[native code]')) {
    return arg.toString()
  }

  let classes = ''

  for (const key in arg) {
    if (hasOwn.call(arg, key) && (arg as any)[key]) {
      classes = appendClass(classes, key)
    }
  }

  return classes
}

function appendClass(value: string, newClass: string) {
  if (!newClass) {
    return value
  }

  return value ? (`${value} ${newClass}`) : newClass
}
