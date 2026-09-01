import type { NS } from '@ns';
import { parseArgs } from './utils/args';

/** @param {NS} ns */
export async function main(ns: NS) {
  const args = parseArgs(ns, [
    { long: 'lines', defaultValue: false, description: 'Count lines', short: 'l' },
    { long: 'words', defaultValue: false, description: 'Count words', short: 'w' },
    { long: 'chars', defaultValue: false, description: 'Count chars', short: 'c' },
  ])

  for (const filename of args._) {
    // Ensure a filename argument is provided
    if (!filename) {
      ns.tprint('ERROR: Please specify a filename. Usage: run wc.js <filename>')
      return
    }

    // Check if the file exists on the current server
    if (!ns.fileExists(String(filename))) {
      ns.tprint(`ERROR: File '${filename}' does not exist.`)
      return
    }

    // Read the file contents
    const content = ns.read(String(filename))

    // Calculate metrics
    const lineCount = args.lines ? content.split(/\r\n|\r|\n/).length : undefined
    const wordCount = args.words ? content.trim() === '' ? 0 : content.trim().split(/\s+/).length : undefined
    const charCount = args.chars ? content.length : undefined

    // Output the results to the terminal
    ns.tprint(
      `${String(filename)}: ${[
        ...lineCount ? [`Lines: ${lineCount}`] : [],
        ...wordCount ? [`Words: ${lineCount}`] : [],
        ...charCount ? [`Lines: ${charCount}`] : [],
      ].join(' | ')}`,
    )
  }
}
