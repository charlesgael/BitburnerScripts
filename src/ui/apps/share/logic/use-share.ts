import { useQueuedNs } from "../../../context/ns-queue-context";
import { useAddChildPid } from "../../../context/child-pids-context";
import { useHomeRam } from "../../../context/home-ram-context";
import { fetchCloudList, CloudServerRow } from "../../../utils/cloud-list";
import { readXpFarmHosts } from "../../../utils/xp-farm-config";
import { ShareHost } from "./types";

// Where daemons/cloud-list.daemon.js itself runs to produce the purchased-
// server snapshot — same convention as the XP Farm/Programs apps.
const CLOUD_LIST_HOST = "home";

/** All state/behavior for the app's own card grid: the cloud-server list
 * (minus hosts XP Farm has dedicated — see `../index.ts`'s header comment)
 * plus `home` itself, and the RAM-patch callback each card reports back
 * through. Per-card state/behavior lives in `use-share-host-card.ts`. */
export function useShare(React: any) {
    const ns = useQueuedNs();
    const addChildPid = useAddChildPid();
    const homeRam = useHomeRam();

    const [cloudServers, setCloudServers]: [
        CloudServerRow[],
        (v: CloudServerRow[] | ((prev: CloudServerRow[]) => CloudServerRow[])) => void
    ] = React.useState([]);
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState(null);

    async function refresh() {
        setLoading(true);
        setError(null);
        try {
            const [cloudList, xpFarmHosts] = await Promise.all([
                fetchCloudList(ns, addChildPid, CLOUD_LIST_HOST),
                readXpFarmHosts(ns),
            ]);
            const dedicated = new Set(xpFarmHosts);
            setCloudServers(cloudList.servers.filter((s: CloudServerRow) => !dedicated.has(s.hostname)));
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setLoading(false);
        }
    }

    // This component remounts every time the window is opened — fetch the
    // cloud-server list fresh rather than trusting stale state. `home`'s own
    // RAM comes live from useHomeRam() (see ui/context/home-ram-context.ts)
    // and needs no fetch of its own.
    React.useEffect(() => {
        void refresh();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Patches a single cloud host's usedRam in place — how a card reports
    // back the RAM it just consumed/freed by starting/stopping a share
    // daemon, without waiting on a full Refresh (see use-share-host-card.ts's
    // syncUsedRam for why that matters).
    function updateCloudUsedRam(hostname: string, usedRam: number) {
        setCloudServers((prev: CloudServerRow[]) => prev.map((s) => (s.hostname === hostname ? { ...s, usedRam } : s)));
    }

    const hosts: ShareHost[] = [
        {
            hostname: "home",
            maxRam: homeRam.max,
            usedRam: homeRam.used,
            isHome: true,
        },
        ...cloudServers.map((s) => ({
            hostname: s.hostname,
            maxRam: s.ram,
            usedRam: s.usedRam,
            isHome: false,
        })),
    ];

    return {
        ns,
        loading,
        error,
        refresh,
        hosts,
        updateCloudUsedRam,
    };
}

/** Everything `ShareContent` needs from this hook. */
export type ShareState = ReturnType<typeof useShare>;
