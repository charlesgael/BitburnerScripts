import { NS, Server } from "@ns";

class Program {
    constructor(
        public filename: string,
        public execute: (host: string) => void
    ) {}
}

export async function main(ns: NS) {
    ns.disableLog(`ALL`);
    const tenMinutes = 1000 * 60 * 10;
    const serverFile = `known-servers.json.txt`;
    const programs = [
        new Program(`BruteSSH.exe`, (host) => ns.brutessh(host)),
        new Program(`SQLInject.exe`, (host) => ns.sqlinject(host)),
        new Program(`relaySMTP.exe`, (host) => ns.relaysmtp(host)),
        new Program(`FTPCrack.exe`, (host) => ns.ftpcrack(host)),
        new Program(`HTTPWorm.exe`, (host) => ns.httpworm(host)),
    ];
    while (true) {
        const servers: Server[] = JSON.parse(ns.read(serverFile));
        ns.print(`\nReloaded ${serverFile}`);
        const playerSkill = ns.getHackingLevel();
        // "home" explicitly, not the default (the server this script is
        // currently running on) — the port-cracking .exe programs only ever
        // exist there regardless of where this script itself is deployed
        // (see e.g. ns.ftpcrack's doc: "FTPCrack.exe must exist on your home
        // computer"), so checking the running host would report 0 owned
        // programs whenever this is run on a cloud server to save home RAM,
        // even though brutessh()/etc. below check home internally anyway
        // and would have worked fine.
        const ownedPrograms = programs.filter((p) => ns.fileExists(p.filename, "home"));

        let crackedAny = false;
        for (let server of servers) {
            // Already done — not worth a log line every cycle for the bulk
            // of the network that's just sitting there rooted.
            if (server.hasAdminRights) continue;
            if (
                server.requiredHackingSkill &&
                server.requiredHackingSkill > playerSkill
            ) {
                ns.print(
                    `${server.hostname}: skipping — hacking skill ${playerSkill}/${server.requiredHackingSkill} required.`
                );
                continue;
            }
            if (
                server.numOpenPortsRequired &&
                server.numOpenPortsRequired > ownedPrograms.length
            ) {
                ns.print(
                    `${server.hostname}: skipping — needs ${server.numOpenPortsRequired} open ports, only ${ownedPrograms.length} cracking program(s) owned.`
                );
                continue;
            }

            ns.print(`\nCracking ${server.hostname}...`);
            ns.print(
                `Skill: ${playerSkill}/${server.requiredHackingSkill} Ports: ${server.openPortCount}/${server.numOpenPortsRequired}`
            );
            ns.print(`Opening ports...`);
            for (let program of ownedPrograms) {
                program.execute(server.hostname);
            }

            ns.print(`Nuking...`);
            ns.nuke(server.hostname);
            ns.print(`${server.hostname} cracked.`);
            crackedAny = true;
        }

        if (!crackedAny) {
            ns.print(`No known crackable servers.`);
        }

        ns.print(
            `Will search again at ${new Date(
                Date.now() + tenMinutes
            ).toLocaleTimeString(undefined, { hour12: false })}.`
        );
        await ns.sleep(tenMinutes);
    }
}
