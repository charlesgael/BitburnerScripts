import type { NS } from '@ns'

export async function main(ns: NS) {
  ns.tprint(`
\x1B[1mWelcome to \x1B[32mBitburnerScripts\x1B[39m!\x1B[0m

In order to start using the scripts, depending on RAM some options are there

\x1B[1m\x1B[4m8Go (starter) to 32GB\x1B[0m
Add assets to be more comfortable
> assets.app.js
Follow tutorial until you root a 8GB RAM server at least (16GB for more comfort)
Then start UI
> start.js max [slave-server (eg. foodnstuff)]

\x1B[1m\x1B[4m32GB and more\x1B[0m
Just start UI, home will be enough
> start.js`)
}
