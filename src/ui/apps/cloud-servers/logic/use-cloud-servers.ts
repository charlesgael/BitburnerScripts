import { useQueuedNs } from "../../../context/ns-queue-context";
import { useAddChildPid } from "../../../context/child-pids-context";
import { useHomeRam } from "../../../context/home-ram-context";
import { runDaemon } from "../../../utils/run-daemon";
import { CLOUD_LIST_SCRIPT, CLOUD_LIST_RESULT_FILE, CloudListResult, CloudServerRow } from "../../../utils/cloud-list";
import { pickCloudServerName } from "../../../utils/cloud-names";
import { ActionResult } from "./types";

const DAEMON_HOST = "home";
const BUY_SCRIPT = "daemons/cloud-buy.daemon.js";
const BUY_RESULT_FILE = "cloud-buy-result.txt";
const DELETE_SCRIPT = "daemons/cloud-delete.daemon.js";
const DELETE_RESULT_FILE = "cloud-delete-result.txt";

/** All Cloud Servers state and behavior. See `../index.ts`'s header comment
 * for why this app never references `ns.cloud.*`/`ns.getServerMoneyAvailable`
 * itself and instead round-trips through the three cloud-*.daemon.ts scripts. */
export function useCloudServers(React: any) {
    const ns = useQueuedNs();
    const addChildPid = useAddChildPid();
    const homeRam = useHomeRam();

    const [servers, setServers]: [CloudServerRow[], (v: CloudServerRow[]) => void] = React.useState([]);
    const [moneyAvailable, setMoneyAvailable] = React.useState(0);
    const [serverLimit, setServerLimit] = React.useState(0);
    const [costByRam, setCostByRam]: [Record<number, number>, (v: Record<number, number>) => void] = React.useState(
        {}
    );
    const [listLoading, setListLoading] = React.useState(true);
    const [listError, setListError]: [string | null, (v: string | null) => void] = React.useState(null);

    const [buyHostname, setBuyHostname] = React.useState("");
    const [buyRam, setBuyRam] = React.useState(2);
    const [buyBusy, setBuyBusy] = React.useState(false);
    const [buyError, setBuyError]: [string | null, (v: string | null) => void] = React.useState(null);

    const [confirmDeleteHost, setConfirmDeleteHost]: [string | null, (v: string | null) => void] =
        React.useState(null);
    const [deleteBusyHost, setDeleteBusyHost]: [string | null, (v: string | null) => void] = React.useState(null);
    const [deleteError, setDeleteError]: [string | null, (v: string | null) => void] = React.useState(null);

    const [daemonRam, setDaemonRam] = React.useState({ list: 0, buy: 0, delete: 0 });

    const busy = listLoading || buyBusy || deleteBusyHost != null;
    const freeRam = homeRam.max - homeRam.used;

    async function refreshList() {
        setListLoading(true);
        setListError(null);
        try {
            const result: CloudListResult = await runDaemon(
                ns,
                addChildPid,
                CLOUD_LIST_SCRIPT,
                DAEMON_HOST,
                CLOUD_LIST_RESULT_FILE
            );
            setServers(result.servers);
            setMoneyAvailable(result.moneyAvailable);
            setServerLimit(result.serverLimit);
            setCostByRam(result.costByRam);
            // Default the RAM picker to the cheapest tier the player can
            // currently afford, if nothing sensible (or no longer
            // affordable) is selected.
            const tiers = Object.keys(result.costByRam)
                .map(Number)
                .sort((a, b) => a - b);
            const affordableTiers = tiers.filter((t) => result.costByRam[t] <= result.moneyAvailable);
            if (tiers.length > 0 && (!tiers.includes(buyRam) || result.costByRam[buyRam] > result.moneyAvailable)) {
                setBuyRam(affordableTiers.length > 0 ? affordableTiers[0] : tiers[0]);
            }
        } catch (err) {
            setListError(err instanceof Error ? err.message : String(err));
        } finally {
            setListLoading(false);
        }
    }

    // This component remounts every time the window is opened — fetch
    // everything fresh rather than trusting stale state.
    React.useEffect(() => {
        let cancelled = false;
        (async () => {
            const [listRam, buyRam_, deleteRam] = await Promise.all([
                ns.getScriptRam(CLOUD_LIST_SCRIPT, DAEMON_HOST),
                ns.getScriptRam(BUY_SCRIPT, DAEMON_HOST),
                ns.getScriptRam(DELETE_SCRIPT, DAEMON_HOST),
            ]);
            if (cancelled) return;
            setDaemonRam({ list: listRam, buy: buyRam_, delete: deleteRam });
        })();
        void refreshList();
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    async function handleBuy() {
        // Leaving the field blank isn't an error — fall back to a random
        // themed name (see `ui/utils/cloud-names.ts`) rather than forcing
        // the player to come up with one.
        const hostname = buyHostname.trim() || pickCloudServerName(servers.map((s) => s.hostname));
        setBuyError(null);
        if (daemonRam.buy > freeRam) {
            setBuyError(`Not enough free RAM to launch ${BUY_SCRIPT} (needs ${daemonRam.buy.toFixed(2)} GB).`);
            return;
        }
        setBuyBusy(true);
        try {
            const result: ActionResult = await runDaemon(ns, addChildPid, BUY_SCRIPT, DAEMON_HOST, BUY_RESULT_FILE, [
                hostname,
                buyRam,
            ]);
            if (!result.ok) {
                setBuyError(result.error ?? "Purchase failed.");
                return;
            }
            setBuyHostname("");
            await refreshList();
        } catch (err) {
            setBuyError(err instanceof Error ? err.message : String(err));
        } finally {
            // No manual RAM refresh needed: HomeRamContext updates on its
            // own schedule (see ui/utils/home-ram-poller.ts) regardless of
            // what this app does.
            setBuyBusy(false);
        }
    }

    function handleDeleteClick(hostname: string) {
        if (confirmDeleteHost === hostname) {
            void doDelete(hostname);
        } else {
            setConfirmDeleteHost(hostname);
        }
    }

    async function doDelete(hostname: string) {
        setConfirmDeleteHost(null);
        setDeleteError(null);
        if (daemonRam.delete > freeRam) {
            setDeleteError(`Not enough free RAM to launch ${DELETE_SCRIPT} (needs ${daemonRam.delete.toFixed(2)} GB).`);
            return;
        }
        setDeleteBusyHost(hostname);
        try {
            const result: ActionResult = await runDaemon(ns, addChildPid, DELETE_SCRIPT, DAEMON_HOST, DELETE_RESULT_FILE, [
                hostname,
            ]);
            if (!result.ok) {
                setDeleteError(result.error ?? "Delete failed.");
                return;
            }
            await refreshList();
        } catch (err) {
            setDeleteError(err instanceof Error ? err.message : String(err));
        } finally {
            // No manual RAM refresh needed: HomeRamContext updates on its
            // own schedule (see ui/utils/home-ram-poller.ts) regardless of
            // what this app does.
            setDeleteBusyHost(null);
        }
    }

    const ramTiers = Object.keys(costByRam)
        .map(Number)
        .sort((a, b) => a - b);
    const selectedCost = costByRam[buyRam] ?? 0;
    const atServerLimit = servers.length >= serverLimit && serverLimit > 0;
    const insufficientMoney = selectedCost > moneyAvailable;
    const buyDisabled = buyBusy || atServerLimit || insufficientMoney;

    return {
        servers,
        moneyAvailable,
        serverLimit,
        costByRam,
        listLoading,
        listError,
        refreshList,
        busy,

        buyHostname,
        setBuyHostname,
        buyRam,
        setBuyRam,
        buyBusy,
        buyError,
        handleBuy,
        ramTiers,
        selectedCost,
        atServerLimit,
        insufficientMoney,
        buyDisabled,

        confirmDeleteHost,
        deleteBusyHost,
        deleteError,
        handleDeleteClick,
    };
}

/** Everything a rendering component under `../components/` needs. */
export type CloudServersState = ReturnType<typeof useCloudServers>;
