import type { NS } from '@ns'

export async function main(ns: NS) {
  const targets = ns.args
  if (!targets.length) {
    ns.tprint('Please provide a target server name. Example: run path.js fulcrumassets')
    return
  }

  while (targets.length) {
    const target = String(targets.shift())
    const visited = new Set()
    const queue = [['home']]
    let found = false

    while (queue.length > 0) {
      const path = queue.shift()!
      const node = path[path.length - 1]

      if (node === target) {
        ns.tprint(`found:  home; ${path.slice(1).map(server => `connect ${server}`).join('; ')}`)
        found = true
        break
      }

      if (!visited.has(node)) {
        visited.add(node)
        const scanResults = ns.scan(node)
        for (const neighbor of scanResults) {
          if (!visited.has(neighbor)) {
            queue.push([...path, neighbor])
          }
        }
      }
    }
    if (!found)
      ns.tprint(`Server '${target}' not found. Make sure the name is spelled correctly.`)
    await ns.sleep(100)
  }
}
