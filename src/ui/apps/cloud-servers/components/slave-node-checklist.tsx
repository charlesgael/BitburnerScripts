import { CloudServersState } from "../logic/use-cloud-servers";

/** The Slave Nodes tab's body: every rooted, non-purchased, non-`home` host
 * on the network (`cs.slaveHosts`, from `cgd/actions/slave-nodes.ts`) as a
 * checkbox row, checked against whichever of those are currently designated
 * (`cs.slaveServers`, from the merged `cgd/actions/cloud.ts` snapshot — see
 * `ui/utils/slave-nodes.ts`'s header comment for the full design). Ticking a
 * box designates/releases that host immediately — no separate Add/Save
 * step. */
export function SlaveNodeChecklist({
    React,
    cs,
}: {
    React: any;
    cs: CloudServersState;
}) {
    const designated = new Set(cs.slaveServers.map((s) => s.hostname));

    if (cs.slaveHosts.length === 0 && !cs.slaveHostsLoading) {
        return (
            <div style={{ fontSize: "12px", opacity: 0.7 }}>
                No rooted servers found yet — crack a few with the Programs app
                first.
            </div>
        );
    }

    return (
        <div>
            <div
                className="bb-text-warning"
                style={{
                    fontSize: 12,
                    marginBottom: 8,
                }}
            >
                ⚠ When changing slaves, remember to restart Flooder program.
            </div>
            <div
                style={{
                    display: "grid",
                    gridTemplateColumns:
                        "repeat(auto-fill, minmax(260px, 1fr))",
                    gap: "8px",
                }}
            >
                {cs.slaveHosts.map((h) => {
                    const checked = designated.has(h.hostname);
                    const busy = cs.toggleSlaveBusyHost === h.hostname;
                    return (
                        <label
                            key={h.hostname}
                            className="bb-card"
                            style={{
                                flexDirection: "row",
                                alignItems: "center",
                                justifyContent: "space-between",
                                cursor: busy ? "default" : "pointer",
                            }}
                        >
                            <span
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "8px",
                                    minWidth: 0,
                                }}
                            >
                                <input
                                    type="checkbox"
                                    checked={checked}
                                    disabled={busy}
                                    onChange={() =>
                                        void cs.toggleSlave(h.hostname)
                                    }
                                />
                                <span className="bb-wrap">
                                    {h.hostname} ({h.ram} GB)
                                </span>
                            </span>
                            {busy ? (
                                <span
                                    style={{ fontSize: "11px", opacity: 0.7 }}
                                >
                                    ...
                                </span>
                            ) : null}
                        </label>
                    );
                })}
            </div>
        </div>
    );
}
