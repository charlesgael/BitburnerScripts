# Bitburner Scripts

[![License](https://img.shields.io/github/license/Drakmyth/BitburnerScripts)](https://github.com/Drakmyth/BitburnerScripts/blob/master/LICENSE.md)
[![Game Version](https://img.shields.io/badge/game_version-2.5.0-blue)](https://github.com/bitburner-official/bitburner-src/releases/tag/v2.5.0)

This repository contains scripts I have written while playing the idle hacking game [Bitburner](https://store.steampowered.com/app/1812820/Bitburner/). Note that although the scripts are written in TypeScript, the game only understands JavaScript. See the [IDE Integration](#ide-integration) section for more information. When executing scripts, the filename should be referenced using a `*.js` extension rather than `*.ts`.

## Appliction Scripts

Application scripts will persistently run in the background and continue operating until terminated.

- [backdoor.app.ts](src/backdoor.app.ts) - Automatically installs backdoors on servers the player has admin access to, using `known-servers.json.txt`. Requires Source-File 4. Walks the network to each target, connects to it, installs the backdoor, then returns to `home`. Skips `home` and purchased servers, and prints a status table (`free`/`backdoor`) of all rooted servers to the terminal every cycle.
- [backdoor.lite.app.ts](src/backdoor.lite.app.ts) - No-RAM, non-Singularity companion to `backdoor.app.ts`: reads `known-servers.json.txt` and prints the list of rooted, non-purchased servers that don't have a backdoor yet, without installing anything. One-shot (not a background loop) — useful when you don't have the RAM or Source-File 4 for the real installer.

- [contracts.app.ts](src/contracts.app.ts) - Finds and automatically solves contracts. Uses `known-servers.json.txt`. Update ContractSolvers list in [contracts.lib.ts](#library-scripts) to add new contract solvers.

- [cracker.app.ts](src/cracker.app.ts) - Automatically cracks servers as cracking requirements are met. Uses `known-servers.json.txt`. Skips servers that cannot be cracked due to low hacking skill, missing port opener programs, or admin access already being available.

- [flooder.app.ts](src/flooder.app.ts) - Monitors servers provided by `known-servers.json.txt`. For servers that the player has admin access to, this script will deploy and execute [weaken.daemon.ts](#daemon-scripts) against each server until it has reached its minimum security level at which point it will deploy and execute all three daemon scripts. Tries to identify a ratio of daemons so as to optimize keeping the money level high and the security level low while using as much ram on the target server as possible. If the target server is not able to be hacked (its max money is 0) it will use that server as a host (called a bot) to hack other servers. Every cycle of this script it will re-target all bots so as to simultaneously hack as many other servers as possible.

- [hacknet.app.ts](src/hacknet.app.ts) - Automatically purchases and upgrades hacknet nodes. Will use up to 25% of the player's current money to buy a new hacknet node or the most expensive upgrade available.

- [netmapper.app.ts](src/netmapper.app.ts) - Crawls the network to identify servers and stores its findings in `known-servers.json.txt`. This file is used by other application scripts to avoid having to walk the network to get a list of servers.

- [next-targets.app.ts](src/next-targets.app.ts) - Uses `known-servers.json.txt`. One-shot report of not-yet-rooted servers: the 3 closest to hack by required hacking level, and the 3 closest to hack by how many more port-opener programs are needed versus what's currently owned on `home`.

## Sidebar UI (`ui.app.ts`)

The scripts above predate, and run independently of, this repository's other major piece: a persistent sidebar UI
mounted directly into the game's own React tree, plus a small daemon system that backs it. Start it with:

```sh
$ run start.js [TIER] [REMOTE]
```

`start.js` is the one command to run — it's idempotent, safe to rerun any time. It starts a persistent background
daemon at the highest RAM tier `home` can currently afford (or a specific `TIER`/`REMOTE` host, if given), waits
for it to come up, then launches `assets.app.js` (this project's own custom CSS) and `ui.app.js` (the sidebar
itself).

`ui.app.js` mounts its React tree once and exits rather than running continuously — every `ns.*` call any app needs
is answered by the daemon instead, over a shared `window.cgd` namespace, which is what keeps `ui.app.js`'s own RAM
footprint down near Bitburner's base script overhead regardless of how many apps it offers. The daemon's tier is a
deliberate RAM/capability dial, not an implementation detail: tier 0 costs nothing beyond a few live stats in the
game's own overview panel, tier 1 unlocks the core toolset every app below needs, tier 2 additionally unlocks
cloud-server/slave-node management. See [CLAUDE.md](CLAUDE.md) and
[docs/epic-cgd-namespace.md](docs/epic-cgd-namespace.md) for the full design and every tradeoff behind it.

Apps available from the sidebar's icon grid (`src/ui/apps/`), opened into their own draggable, independently
closable floating windows:

- **[Trainer](src/ui/apps/trainer)** - Trains a chosen stat toward a target level via Singularity actions.
  Requires Source-File 4.
- **[Programs](src/ui/apps/programs)** - Spawns any of `cracker`/`flooder`/`backdoor`/`backdoor.lite`/
  `next-targets`/`netmapper.app.js` on `home` or a cloud/slave server, with a live running-task list to
  kill/tail each one.
- **[Cloud Servers](src/ui/apps/cloud-servers)** - Buy, list, and delete purchased servers, and designate
  already-rooted network servers as "slave nodes" standing in for a purchased server before you can afford one.
- **[Share](src/ui/apps/share)** - Dedicates spare RAM on `home` or any cloud/slave server to `ns.share()` for
  faster faction reputation gain while working for a faction.
- **[XP Farm](src/ui/apps/xp-farm)** - Dedicates cloud/slave servers to a self-managing grow/weaken loop against
  whichever rooted server currently gives the most hacking XP per completed call.
- **[File Explorer](src/ui/apps/file-explorer)** - Browse, view/edit, run, rename, delete, and copy files across
  `home` and every other known host.
- **[Hello World](src/ui/apps/hello-world)** - A minimal example app, mainly useful as a reference for the
  queued-`ns` pattern every other app uses.

## Daemon Scripts

This section covers only the three generic hack/grow/weaken loops below — daemon scripts (in the sense meant here)
are application scripts that execute continuous hack, grow, or weaken calls against a hostname, waiting for a delay
period between each call. If the delay is -1, the call will be executed once and the script will terminate.

`src/daemons/` also holds the tiered daemon backing the sidebar UI above (`lv0`/`lv1`/`lv2.daemon.ts`) and a few
other worker/Singularity daemons apps launch on demand (`share`/`xp-farm`/`train.daemon.ts`) — see the Sidebar UI
section and [CLAUDE.md](CLAUDE.md) for those.

- [hack.daemon.ts](src/daemons/hack.daemon.ts) - Executes hack against `HOST` waiting `DELAY` milliseconds between calls.

  - ```sh
    $ run daemons/hack.daemon.js HOST DELAY
    ```

- [grow.daemon.ts](src/daemons/grow.daemon.ts) - Executes grow against `HOST` waiting `DELAY` milliseconds between calls.

  - ```sh
    $ run daemons/grow.daemon.js HOST DELAY
    ```

- [weaken.daemon.ts](src/daemons/weaken.daemon.ts) - Executes weaken against `HOST` waiting `DELAY` milliseconds between calls.
  - ```sh
    $ run daemons/weaken.daemon.js HOST DELAY
    ```

## Functional Scripts

Functional scripts are intended to be executed manually to display information or carry out simple interactions that generally are not desired to be continuous. They will terminate automatically once they have completed execution.

- [init.ts](src/init.ts) - Executes a hardcoded list of application scripts. This makes restarting those scripts easier after installing augments. Waits 1 second between each script to allow any initialization to complete before starting the next service. Note that the scripts will be executed in order and if there is not enough RAM on the host server to run a script it will be skipped.

- [map.ts](src/map.ts) - Displays a recursive network tree starting at `HOST` (if provided, otherwise "home").

  - ```sh
    $ run map.js [OPTION] [HOST]

    Options:
    -l, --level             Show hacking skill required to hack server
    -m, --money             Show money available on each server
    -o, --organization      Show the organization name of each server
    -r, --root              Show user access level of each server
    ```

- [servers.ts](src/servers.ts) - Purchases or upgrades servers to the maximum amount of RAM affordable. Always purchases maximum number of servers and keeps all server resources equivalent. Running scripts will be terminated before upgrade. Will only purchase servers able to concurrently run at least one thread of each daemon script.

  - ```sh
    $ run servers.js [OPTION]

    Options:
    -s, --simulate          Simulates the upgrade process to display the required
                            cost without purchasing new servers or terminating
                            existing scripts.
    ```

## Library Scripts

Library scripts are not themselves executable, but contain functions or constants that are intended to be imported into other scripts.

- [contracts.lib.ts](src/contracts.lib.ts) - Contains classes and definitions that facilitate common execution of coding contract solvers.
- [ports.lib.ts](src/ports.lib.ts) - Contains constants that define which ports to use for different purposes.

## Contract Solvers

Contract solvers are used by [contracts.app.ts](#appliction-scripts) to automatically complete contracts. Solvers should not be executed manually as they rely on having a second script listening on a port to receive the contract solution.

| Contract                                | Script                                                                                                             |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Algorithmic Stock Trader I              | [contracts/algorithmic-stock-trader.ts](src/lib/contracts/algorithmic-stock-trader.ts)<sup>1</sup>                 |
| Algorithmic Stock Trader II             | [contracts/algorithmic-stock-trader.ts](src/lib/contracts/algorithmic-stock-trader.ts)<sup>1</sup>                 |
| Algorithmic Stock Trader III            | [contracts/algorithmic-stock-trader.ts](src/lib/contracts/algorithmic-stock-trader.ts)<sup>1</sup>                 |
| Algorithmic Stock Trader IV             | [contracts/algorithmic-stock-trader.ts](src/lib/contracts/algorithmic-stock-trader.ts)<sup>1</sup>                 |
| Array Jumping Game                      | [contracts/array-jumping-game.ts](src/lib/contracts/array-jumping-game.ts)                                         |
| Array Jumping Game II                   | [contracts/array-jumping-game-ii.ts](src/lib/contracts/array-jumping-game-ii.ts)                                   |
| Compression I: RLE Compression          | [contracts/compression-i-rle-compression.ts](src/lib/contracts/compression-i-rle-compression.ts)                   |
| Compression II: LZ Decompression        | [contracts/compression-ii-lz-decompression.ts](src/lib/contracts/compression-ii-lz-decompression.ts)               |
| Compression III: LZ Compression         | Not Solved Yet...                                                                                                  |
| Encryption I: Caesar Cipher             | [contracts/encryption-i-caesar-cipher.ts](src/lib/contracts/encryption-i-caesar-cipher.ts)                         |
| Encryption II: Vigenère Cipher          | [contracts/encryption-ii-vigenere-cipher.ts](src/lib/contracts/encryption-ii-vigenere-cipher.ts)                   |
| Find All Valid Math Expressions         | [contracts/find-all-valid-math-expressions.ts](src/lib/contracts/find-all-valid-math-expressions.ts)               |
| Find Largest Prime Factor               | [contracts/find-largest-prime-factor.ts](src/lib/contracts/find-largest-prime-factor.ts)                           |
| Generate IP Addresses                   | [contracts/generate-ip-addresses.ts](src/lib/contracts/generate-ip-addresses.ts)                                   |
| HammingCodes: Encoded Binary to Integer | [contracts/hammingcodes-encoded-binary-to-integer.ts](src/lib/contracts/hammingcodes-encoded-binary-to-integer.ts) |
| HammingCodes: Integer to encoded Binary | [contracts/hammingcodes-integer-to-encoded-binary.ts](src/lib/contracts/hammingcodes-integer-to-encoded-binary.ts) |
| Merge Overlapping Intervals             | [contracts/merge-overlapping-intervals.ts](src/lib/contracts/merge-overlapping-intervals.ts)                       |
| Minimum Path Sum in a Triangle          | [contracts/minimum-path-sum-in-a-triangle.ts](src/lib/contracts/minimum-path-sum-in-a-triangle.ts)                 |
| Proper 2-Coloring of a Graph            | [contracts/proper-2-coloring-of-a-graph.ts](src/lib/contracts/proper-2-coloring-of-a-graph.ts)                     |
| Sanitize Parentheses in Expression      | [contracts/sanitize-parentheses-in-expression.ts](src/lib/contracts/sanitize-parentheses-in-expression.ts)         |
| Shortest Path in a Grid                 | [contracts/shortest-path-in-a-grid.ts](src/lib/contracts/shortest-path-in-a-grid.ts)                               |
| Spiralize Matrix                        | [contracts/spiralize-matrix.ts](src/lib/contracts/spiralize-matrix.ts)                                             |
| Subarray with Maximum Sum               | [contracts/subarray-with-maximum-sum.ts](src/lib/contracts/subarray-with-maximum-sum.ts)                           |
| Total Ways to Sum                       | [contracts/total-ways-to-sum.ts](src/lib/contracts/total-ways-to-sum.ts)<sup>1</sup>                               |
| Total Ways to Sum II                    | [contracts/total-ways-to-sum.ts](src/lib/contracts/total-ways-to-sum.ts)<sup>1</sup>                               |
| Unique Paths in a Grid I                | [contracts/unique-paths-in-a-grid.ts](src/lib/contracts/unique-paths-in-a-grid.ts)<sup>1</sup>                     |
| Unique Paths in a Grid II               | [contracts/unique-paths-in-a-grid.ts](src/lib/contracts/unique-paths-in-a-grid.ts)<sup>1</sup>                     |

<sup>1</sup> <small>Different difficulties of the same contract may in some cases be able to be solved by the same implementation. This usually requires slight pre-processing of the input for lower difficulties. This pre-processing is performed by [contracts.app.ts](#appliction-scripts) where applicable.</small>

## IDE Integration

These scripts can be copy-pasted into the game, or you can edit them in your editor of choice and have them update in the game automatically! This process used to be a lot easier due to the existence of an official VS Code extension, but that has sadly been deprecated in favor of a clunky build server approach.

This approach does have two significant advantages though:

1. Any IDE can benefit from full integration, not just VS Code.
1. It enables the ability to write scripts using [TypeScript](https://www.typescriptlang.org) by transpiling the scripts during the upload process.

Because it's a bit faster and more fully-featured, this repository is configured to use the unofficial [Viteburner](https://github.com/Tanimodori/viteburner) server rather than the official [bitburner-filesync](https://github.com/bitburner-official/bitburner-filesync) server. To host the contents of this repository using Viteburner:

1. Clone this repository
1. Start the Viteburner server
   ```sh
   $ npx viteburner
   ```
1. Inside the Bitburner game, in the left sidebar:
   1. Enable the Remote API by selecting `Options -> Remote API`
   1. Enter the port Viteburner is running on (should be `12525` by default and is displayed in the terminal after starting the server)
   1. Click the `Connect` button

See [viteburner-template](https://github.com/Tanimodori/viteburner-template) for information on configuring your own repository.

:warning: Note: If at any time the game is running and the server isn't, the Remote API will be disabled and you'll have to re-enable it manually. It will _NOT_ be automatically enabled when starting the server. The server should be the first to start and the last to close..

## Enabling Intellisense

Viteburner will automatically add an up-to-date type definition file to the root directory. In your `*.ts` scripts you can then just import and reference all the Bitburner types directly. If you're still using `*.js` scripts and value your sanity, you should migrate to TypeScript! If you _really_ want to keep using JavaScript, you'll need to add [JSDoc](https://jsdoc.app) comments above each function with a relative path to the types file.

```js
/** @param {import("../NetscriptDefinitions.d.ts").NS} ns */
export async function main(ns) {
  ns.tprint(`Hello world!`)
}
```

This is because the type definition file does not expose the Bitburner types as globals or as namespaces. If you try to add those constructs to the `NetscriptDefinitions.d.ts` file manually Viteburner is going to overwrite it, so this is the only available option.

## License

These scripts are licensed under the MIT License (MIT). See LICENSE for details.
