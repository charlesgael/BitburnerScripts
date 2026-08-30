export interface OpenWindow {
  id: string
  x: number
  y: number
  z: number
  refreshCount: number
  /**
   * The app's `preferredWidth`/`preferredHeight` (see `ui/types.ts`),
   * captured once at open time. Applied to the DOM node imperatively via
   * a `ref` (see `sizeWindowNode` below) rather than through React's
   * `style` prop, so it only ever sets the *starting* size — if it were
   * a normal style prop, every re-render (e.g. every mousemove while
   * dragging the title bar) would reassert it and stomp whatever size
   * the player dragged the window's own resize handle to.
   */
  width?: number
  height?: number
}
