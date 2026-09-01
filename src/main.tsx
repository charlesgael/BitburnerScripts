import type { NS } from '@ns'
import React from '@react'
import { sendTerminal } from './utils/send-terminal'

function StartBtn() {
  async function click() {
    await sendTerminal('run start.js')
    await sendTerminal('clear')
  }

  return (
    <button style={{ margin: 10, padding: '5px 10px', fontFamily: 'inherit' }} onClick={click}>Run ui.app</button>
  )
}

export async function main(ns: NS) {
  ns.tprintRaw(
    <>
      <div>Welcome back, let's start hacking!</div>
      <StartBtn />
    </>,
  )
}
