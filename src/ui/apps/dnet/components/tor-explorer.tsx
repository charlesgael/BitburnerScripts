import React, { useState } from '@react'
import { getFilesystemStore, resetFilesystemStore } from '../../../../lib/dnet/filesystem'
import { InstanceManager } from '../../../components/instance-manager'

import { Menu } from '../../../components/navigation/menu/menu'
import { TitlebarToolbar } from '../../../components/window/titlebar-toolbar'

function useConfirm(cb: () => Promise<void> | void) {
  const [id, setId] = useState<NodeJS.Timeout | undefined>()
  const [confirm, setConfirm] = useState(false)
  const [error, setError] = useState<string | null>()
  const exec = async () => {
    clearTimeout(id)
    if (confirm) {
      try {
        await Promise.resolve(cb())
      }
      catch (e) {
        console.error(e)
        setError(`${e}`)
      }
      setConfirm(false)
    }
    else {
      setConfirm(true)
      setId(setTimeout(setConfirm, 3000, false))
    }
  }

  return [confirm, exec, error] as const
}

export function TorExplorer() {
  const fsStore = getFilesystemStore()

  const [host, setHost] = useState<string | null>(null)
  const [file, setFile] = useState<string | null>(null)

  const [confirm, exec] = useConfirm(() => {
    void resetFilesystemStore()
    setTimeout(() => setHost(null))
  })

  return (
    <>
      <TitlebarToolbar>
        <button
          onClick={exec}
          className="bb-icon-link"
        >
          {confirm ? 'Sure?' : 'Clear'}
        </button>
        <InstanceManager filename="darknet.app.js" host="home" />
      </TitlebarToolbar>
      <div
        style={{
          height: '100%',
          display: 'flex',
        }}
      >
        <div
          style={{
            flexShrink: 0,
            overflowY: 'auto',
            width: 180,
          }}
        >
          <Menu
            options={Object.keys(fsStore).map(it => ({ key: it, label: it }))}
            onValueChange={(newHost) => {
              setHost(newHost)
              setFile(null)
            }}
          />
        </div>

        <div
          style={{
            flexShrink: 0,
            overflowY: 'auto',
            width: 180,
          }}
        >
          {host && <Menu key={host} options={Object.keys(fsStore[host]).map(it => ({ key: it, label: it }))} onValueChange={setFile} />}
        </div>

        <div
          style={{
            minWidth: 320,
            flex: 1,
          }}
        >
          {/* eslint-disable-next-line react/dom-no-dangerously-set-innerhtml */}
          {host && file && <div dangerouslySetInnerHTML={{ __html: fsStore[host][file] }} />}
        </div>
      </div>
    </>
  )
}
