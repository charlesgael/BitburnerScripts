export const ESC = '\x1B[m'
export const BOLD = '\x1B[1m'
export const UNDER = '\x1B[4m'

export const F_BLACK = '\x1B[30m'
export const B_BLACK = '\x1B[40m'
export const F_RED = '\x1B[31m'
export const B_RED = '\x1B[41m'
export const F_GREEN = '\x1B[32m'
export const B_GREEN = '\x1B[42m'
export const F_YELLOW = '\x1B[33m'
export const B_YELLOW = '\x1B[43m'
export const F_BLUE = '\x1B[34m'
export const B_BLUE = '\x1B[44m'
export const F_PURPLE = '\x1B[35m'
export const B_PURPLE = '\x1B[45m'
export const F_CYAN = '\x1B[36m'
export const B_CYAN = '\x1B[46m'
export const F_WHITE = '\x1B[37m'
export const B_WHITE = '\x1B[47m'

export function f(text: string, ...mods: string[]) {
  return `${mods.join('')}${text}${ESC}`
}
