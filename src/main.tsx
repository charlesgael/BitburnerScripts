import type { NS } from '@ns'
import React from '@react'
import { sendTerminal } from './utils/send-terminal'

function StartBtn({ filename, children, clear }: { filename: string, children: any, clear?: boolean }) {
  async function click() {
    await sendTerminal(`run ${filename}`)
    if (clear)
      await sendTerminal('clear')
  }

  return (
    <button style={{ padding: '5px 10px', fontFamily: 'inherit', whiteSpace: 'nowrap' }} onClick={click}>{children}</button>
  )
}

export async function main(ns: NS) {
  const apps = ns.ls('home', '.app.js')

  ns.tprintRaw(
    <>
      <div>Welcome back, let's start hacking!</div>
      <p><StartBtn filename="start.js" clear>Run ui.app</StartBtn></p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {apps.map(app => <StartBtn key={app} filename={app}>{app}</StartBtn>)}
      </div>
    </>,
  )
}
