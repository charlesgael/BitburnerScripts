import { AppComponentProps } from "../../../types";
import { useQueuedNs } from "../../../context/ns-queue-context";

/**
 * Proofing app: says hello, and proves the `useQueuedNs` context hook works
 * end to end by fetching the hostname through it on a button click — reads
 * just like calling `ns` directly, but the call is queued and serialized
 * against the script's main loop instead of racing it.
 */
export function HelloWorldContent({ React }: AppComponentProps) {
    const ns = useQueuedNs();
    const [hostname, setHostname] = React.useState(null);

    async function fetchHostname() {
        setHostname(await ns.getHostname());
    }

    return (
        <div>
            <div style={{ marginBottom: "8px" }}>Hello, world!</div>
            <button onClick={fetchHostname} className="bb-btn">
                Get hostname via queued ns
            </button>
            {hostname ? <div style={{ marginTop: "8px", opacity: 0.85 }}>Host: {hostname}</div> : null}
        </div>
    );
}
