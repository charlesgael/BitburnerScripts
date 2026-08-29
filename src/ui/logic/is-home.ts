import type { Server } from '@ns'

const HOME_NAME = 'home'

export function isHome(server: Server): boolean
export function isHome(server: string): boolean
export function isHome(server: Server | string) {
  if (typeof server === 'object')
    return isHome(server.hostname)
  return server === HOME_NAME
}
