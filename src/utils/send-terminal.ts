import { getWinGlobals } from '@react'

export async function sendTerminal(input: string) {
  return new Promise<void>((resolve) => {
    const { win, doc } = getWinGlobals()

    const terminalInput = doc.getElementById(`terminal-input`)
    if (!terminalInput) {
      return
    }

    // A plain `terminalInput.value = command` doesn't touch React's
    // internal value tracker on a controlled input, so `onChange` never
    // fires. Going through the native property setter (bypassing
    // React's own override of `.value`) and then dispatching a real
    // "input" event is the standard way to make a controlled React
    // input pick up a programmatic value change.
    const nativeValueSetter = Object.getOwnPropertyDescriptor(
      win.HTMLInputElement.prototype,
      `value`,
    )?.set
    if (nativeValueSetter) {
      nativeValueSetter.call(terminalInput, input)
    }
    else {
      terminalInput.value = input
    }
    terminalInput.dispatchEvent(
      new win.Event(`input`, { bubbles: true }),
    )

    // Submitting likewise needs a real KeyboardEvent, not a hand-built
    // object — React derives the SyntheticEvent's key/keyCode from the
    // native event it observes, so a fake object missing a field like
    // `.key` can silently fail to match whatever check the terminal's
    // Enter handler uses.
    //
    // The dispatch is deferred a tick rather than fired immediately
    // after the "input" event above: back-to-back synchronous dispatches
    // outrun React's own state-update flush from that "input" event, so
    // the Enter handler would still see the terminal's *previous* value
    // (e.g. empty) instead of the command chain just set.
    const keyInit = {
      key: `Enter`,
      code: `Enter`,
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true,
    }
    win.setTimeout(() => {
      terminalInput.dispatchEvent(
        new win.KeyboardEvent(`keydown`, keyInit),
      )
      terminalInput.dispatchEvent(
        new win.KeyboardEvent(`keyup`, keyInit),
      )
      resolve()
    }, 50)
  })
}
