import { NS } from "@ns";

export async function main(ns: NS) {
    let targets = ns.args;
    if (!targets.length) {
        ns.tprint("Please provide a target server name. Example: run path.js fulcrumassets");
        return;
    }

    while (targets.length) {
        const target = String(targets.shift());
        let visited = new Set();
        let queue = [["home"]];
        let found = false;

        loopqueue:
        while (queue.length > 0) {
            let path = queue.shift()!;
            let node = path[path.length - 1];

            if (node === target) {
                ns.tprint("found:  home; " + path.slice(1).map(server => `connect ${server}`).join("; "));
                found = true;
                break loopqueue;
            }

            if (!visited.has(node)) {
                visited.add(node);
                let scanResults = ns.scan(node);
                for (let neighbor of scanResults) {
                    if (!visited.has(neighbor)) {
                        queue.push([...path, neighbor]);
                    }
                }
            }
        }
        if (!found)
            ns.tprint(`Server '${target}' not found. Make sure the name is spelled correctly.`);
        await ns.sleep(100);
    }
}
