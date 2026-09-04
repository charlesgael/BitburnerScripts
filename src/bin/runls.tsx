import type { NS } from '@ns'
import React from '@react'
import { groupBy } from '../utils/array/group-by'
import { sendTerminal } from '../utils/send-terminal'

function TreeDisplay({ paths, indent, parent }: { paths: FileInfo[], indent: number, parent: string }) {
  const folders = groupBy(
    paths.filter(({ name }) => name.includes('/'))
      .map(({ name, ...rest }) => ({ folder: name.split('/').slice(0, 1)[0], name: name.split('/').slice(1).join('/'), ...rest })),
    it => it.folder,
  )
  const files = paths.filter(({ name }) => !name.includes('/'))

  return (
    <div style={{ marginLeft: 4 * indent }}>
      {Object.entries(folders).map(([folder, paths]) => (
        <div key={folder}>
          <div>{folder}</div>
          <TreeDisplay paths={paths} indent={1} parent={`${parent}${folder}/`} />
        </div>
      ))}
      {files.map(file => (
        <div key={file.name}>
          <span
            style={{
              textDecoration: 'underline',
              cursor: 'pointer',
            }}
            onClick={() => void sendTerminal(`run ${parent}${file.name}`)}
          >
            {file.name}
          </span>
          {' '}
          (
          {file.ramCost}
          )
        </div>
      ))}
    </div>
  )
}

interface FileInfo {
  name: string
  ramCost: string
}

function getScripts(ns: NS): FileInfo[] {
  return ns.ls(ns.getHostname())
    .filter(it => it.endsWith('.app.js'))
    .map(it => ({
      name: it,
      ramCost: ns.format.ram(ns.getScriptRam(it)),
    }))
}

export function main(ns: NS) {
  // --- Gather data with NS

  const scripts = getScripts(ns)

  // --- Spawn React APP
  // ns.tprint(scripts.map(it => it.name).join('\n'))
  ns.tprintRaw(<TreeDisplay paths={scripts} indent={0} parent="" />)
}
