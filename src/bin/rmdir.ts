import type { NS } from '@ns'

export async function main(ns: NS) {
  // Collect all directories passed as arguments
  const targetDirs = ns.args

  if (targetDirs.length === 0) {
    ns.tprint('ERROR: Please specify at least one directory path. Usage: run rmdir.js [dir1] [dir2] ...')
    return
  }

  // Get a flat list of every file residing on the current server
  const allFiles = ns.ls(ns.getHostname())

  // Process each directory path one by one
  for (const targetDir of targetDirs) {
    // Coerce argument to string and ensure it ends with a slash
    const dirString = String(targetDir)
    const normalizedDir = dirString.endsWith('/') ? dirString : `${dirString}/`

    ns.tprint(`\nINFO: Processing directory deletion for: "${normalizedDir}"`)
    let deletedCount = 0

    for (const file of allFiles) {
      // Target files matching the current directory path
      if (file.startsWith(normalizedDir)) {
        const success = ns.rm(file)
        if (success) {
          ns.tprint(`  Deleted: ${file}`)
          deletedCount++
        }
        else {
          ns.tprint(`  WARNING: Failed to delete ${file}`)
        }
      }
    }

    if (deletedCount > 0) {
      ns.tprint(`SUCCESS: Removed "${normalizedDir}" and ${deletedCount} inner file(s).`)
    }
    else {
      ns.tprint(`INFO: No files found matching "${normalizedDir}".`)
    }
  }
}
