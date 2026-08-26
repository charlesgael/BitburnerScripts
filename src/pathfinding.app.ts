import { NS } from "@ns";

export async function main(ns: NS) {
    const target = ns.args[0];
    if (!target) {
        ns.tprint("Please provide a target server name. Example: run path.js fulcrumassets");
        return;
    }

    let visited = new Set();
    let queue = [["home"]];

    while (queue.length > 0) {
        let path = queue.shift()!;
        let node = path[path.length - 1];

        if (node === target) {
            ns.tprint("Path found! Copy and paste this into your terminal:");
            ns.tprint(path.map(server => `connect ${server}`).join("; "));
            return;
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
    ns.tprint(`Server '${target}' not found. Make sure the name is spelled correctly.`);
}
