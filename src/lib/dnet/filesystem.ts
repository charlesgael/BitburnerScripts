export interface FilesystemStore {
  [hostname: string]: HostFilesystem
}

export interface HostFilesystem {
  [filename: string]: string
}

/**
 * Record of every files encountered during crawling of DNET
 */
export function getFilesystemStore(): FilesystemStore {
  const win = eval('window') as { __dnetFilesystem?: FilesystemStore }
  if (!win.__dnetFilesystem)
    win.__dnetFilesystem = {}
  return win.__dnetFilesystem
}

export function recordFile(hostname: string, filename: string, content: string): void {
  const fs = getFilesystemStore()

  if (!fs[hostname]) {
    console.log('dnet-probe/filesystem$ New host', hostname)
    fs[hostname] = {}
  }

  fs[hostname][filename] = content
}
