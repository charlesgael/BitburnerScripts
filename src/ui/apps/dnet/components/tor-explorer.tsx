import React, { useState } from '@react'

import { getFilesystemStore } from '../../../../lib/dnet/filesystem'
import { Menu } from '../../../components/navigation/menu/menu'

export function TorExplorer() {
  const fsStore = getFilesystemStore()

  const [host, setHost] = useState<string | null>(null)
  const [file, setFile] = useState<string | null>(null)

  return (
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
        {host && <Menu options={Object.keys(fsStore[host]).map(it => ({ key: it, label: it }))} onValueChange={setFile} />}
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
  )
}
