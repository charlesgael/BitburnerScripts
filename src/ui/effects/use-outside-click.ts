import type { RefObject } from 'react'
import { getWinGlobals, useEffect } from '@react'

/**
 * Hook that alerts clicks outside of the passed ref
 */
export function useOutsideClick(ref: RefObject<HTMLElement | null>, callback: (event: MouseEvent) => void) {
  /**
   * Alert if clicked on outside of element
   */
  function handleClickOutside(event: MouseEvent) {
    if (ref.current && !ref.current.contains(event.target as any)) {
      callback(event)
    }
  }

  useEffect(() => {
    // Bind the event listener
    getWinGlobals().doc.addEventListener('click', handleClickOutside)
    return () => {
      // Unbind the event listener on clean up
      getWinGlobals().doc.removeEventListener('click', handleClickOutside)
    }
  }, [callback])
}
