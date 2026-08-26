import { NS } from "@ns";

/**
 * Trains one stat toward a target level via Singularity actions — mirrors
 * `src.prestige/player/train.js`'s `trainStat`/`prepareStats`.
 *
 * Split out of the sidebar Trainer app (`ui/apps/trainer.tsx`) on purpose:
 * Bitburner charges a script for every ns.* function it merely
 * *references* anywhere in its reachable code, whether that code path ever
 * runs or not. universityCourse/gymWorkout/stopAction/isBusy alone are
 * ~88GB, and folding that into ui.app.ts (which is always running) would
 * make its RAM footprint permanent. Kept here instead, this cost only
 * applies while a training session is actually active — the Trainer app
 * spawns/kills this via ns.exec/ns.kill (both a few cents on the GB) rather
 * than calling ns.singularity.* itself.
 *
 * Args: stat ("hacking" | "charisma" | "strength" | "defense" | "dexterity"
 * | "agility"), targetLevel (number), focus (boolean, optional, defaults
 * true).
 */

type StatKey = "hacking" | "charisma" | "strength" | "defense" | "dexterity" | "agility";

const STARTERS: Record<StatKey, (ns: NS, focus: boolean) => boolean> = {
    hacking: (ns, focus) => ns.singularity.universityCourse("Rothman University", "Algorithms", focus),
    charisma: (ns, focus) => ns.singularity.universityCourse("Rothman University", "Leadership", focus),
    strength: (ns, focus) => ns.singularity.gymWorkout("Powerhouse Gym", "str", focus),
    defense: (ns, focus) => ns.singularity.gymWorkout("Powerhouse Gym", "def", focus),
    dexterity: (ns, focus) => ns.singularity.gymWorkout("Powerhouse Gym", "dex", focus),
    agility: (ns, focus) => ns.singularity.gymWorkout("Powerhouse Gym", "agi", focus),
};

export async function main(ns: NS) {
    ns.disableLog("ALL");

    const stat = ns.args[0] as StatKey;
    const targetLevel = Number(ns.args[1]);
    const focus = ns.args[2] === undefined ? true : Boolean(ns.args[2]);

    const start = STARTERS[stat];
    if (!start) {
        ns.tprint(`ERROR: daemons/train.daemon.js — unknown stat "${ns.args[0]}"`);
        return;
    }

    // Stops the in-game action no matter how this script ends — reaching
    // the target below, being killed by the Trainer app's "Stop" button,
    // or a restart — so a kill from the UI can't leave the character
    // training forever in the background.
    ns.atExit(() => {
        ns.singularity.stopAction();
    }, "train-daemon-stop-action");

    while (ns.getPlayer().skills[stat] < targetLevel) {
        if (!ns.singularity.isBusy() && !start(ns, focus)) {
            ns.tprint(`ERROR: daemons/train.daemon.js — couldn't start training ${stat} (wrong city? need Sector-12).`);
            return;
        }
        await ns.sleep(1000);
    }
}
