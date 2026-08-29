import { getCgdStore } from '../../cgd/store'

export function useHomeRam() {
  return getCgdStore().use(s => s.homeRam)
}
