import { NS, Server } from "@ns";

// Requires Source-File 4 to run outside the terminal.
async function findPath(ns: NS, target: string): Promise<string[] | null> {
    if (target === `home`) return [`home`];

    const visited = new Set<string>([`home`]);
    const queue: string[][] = [[`home`]];
    while (queue.length > 0) {
        const path = queue.shift()!;
        const current = path[path.length - 1];

        for (let neighbor of ns.scan(current)) {
            if (visited.has(neighbor)) continue;
            visited.add(neighbor);

            const nextPath = [...path, neighbor];
            if (neighbor === target) return nextPath;
            queue.push(nextPath);
        }
    }

    return null;
}

async function installBackdoor(ns: NS, hostname: string) {
    const path = await findPath(ns, hostname);
    if (!path) {
        ns.print(`Could not find a path to ${hostname}, skipping.`);
        return false;
    }

    for (let i = 1; i < path.length; i++) {
        ns.singularity.connect(path[i]);
    }

    await ns.singularity.installBackdoor();

    for (let i = path.length - 2; i >= 0; i--) {
        ns.singularity.connect(path[i]);
    }

    return true;
}

export async function main(ns: NS) {
    ns.disableLog(`ALL`);
    const tenMinutes = 1000 * 60 * 10;
    const serverFile = `known-servers.json.txt`;

    while (true) {
        const servers: Server[] = JSON.parse(ns.read(serverFile));
        ns.print(`\nReloaded ${serverFile}`);

        const rootedServers = servers.filter(
            (s) =>
                s.hasAdminRights && s.hostname !== `home` && !s.purchasedByPlayer
        );

        for (let server of rootedServers) {
            if (server.backdoorInstalled) continue;

            ns.print(`\nInstalling backdoor on ${server.hostname}...`);
            const success = await installBackdoor(ns, server.hostname);
            if (success) {
                server.backdoorInstalled = true;
                ns.print(`${server.hostname} backdoored.`);
            }
        }

        ns.print(`\n--- Server status (${rootedServers.length}) ---`);
        for (let server of rootedServers) {
            const status = server.backdoorInstalled ? `backdoor` : `free`;
            ns.print(`${server.hostname.padEnd(20)} ${status}`);
        }

        ns.print(
            `Will search again at ${new Date(
                Date.now() + tenMinutes
            ).toLocaleTimeString(undefined, { hour12: false })}.`
        );
        await ns.sleep(tenMinutes);
    }
}
