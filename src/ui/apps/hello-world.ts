import { AppComponentProps, AppDefinition } from "../types";
import { useQueuedNs } from "../context/ns-queue-context";
import { theme } from "../utils/theme";

/**
 * Proofing app: says hello, and proves the `useQueuedNs` context hook works
 * end to end by fetching the hostname through it on a button click — reads
 * just like calling `ns` directly, but the call is queued and serialized
 * against the script's main loop instead of racing it.
 */
function HelloWorldContent({ React }: AppComponentProps) {
    const e = React.createElement;
    const ns = useQueuedNs();
    const [hostname, setHostname] = React.useState(null);

    async function fetchHostname() {
        setHostname(await ns.getHostname());
    }

    return e(
        "div",
        null,
        e("div", { style: { marginBottom: "8px" } }, "Hello, world!"),
        e(
            "button",
            {
                onClick: fetchHostname,
                style: {
                    background: theme.button,
                    color: theme.primary,
                    border: `1px solid ${theme.primary}`,
                    borderRadius: "4px",
                    padding: "4px 10px",
                    cursor: "pointer",
                    fontFamily: "inherit",
                },
            },
            "Get hostname via queued ns"
        ),
        hostname
            ? e("div", { style: { marginTop: "8px", opacity: 0.85 } }, `Host: ${hostname}`)
            : null
    );
}

export const HelloWorldApp: AppDefinition = {
    id: "hello-world",
    icon: "👋",
    label: "Hello World",
    Content: HelloWorldContent,
};
