import { NS, Server, ScriptArg } from "@ns";
import arg from "arg";
import { parseArgs } from "./utils/args";

/**
 * `React` only exists as the game's `window.React` global (see
 * `ui/utils/react-globals.ts`), and the classic JSX transform (this
 * project's `tsconfig.json` `"jsx": "react"`) just needs an identifier
 * literally named `React` lexically in scope wherever a `<tag>` appears —
 * see CLAUDE.md's "`ui.app.ts`" section for the full explanation. Every
 * component below is a plain function at module scope, so a single
 * module-level binding (set once by `getDomContext`) covers all of them,
 * instead of threading a `React` prop through each one the way `ui/apps/`
 * does (that pattern exists there because those components are handed to
 * React by something else; here `main` drives rendering directly).
 */
let React: any;

/** DOM handles reached via the classic `eval("window")` trick — free, but not guaranteed to exist this early, so callers must tolerate `getDomContext` returning null and fall back to plain text. */
interface Dom {
    doc: any;
    win: any;
}

function getDomContext(ns: NS): Dom | null {
    const doc = eval("document");
    const win = eval("window");
    React = win.React;

    if (!React) {
        ns.tprint(
            "WARN: Could not access the game's React global — falling back to a plain-text tree."
        );
        return null;
    }

    return { doc, win };
}

/**
 * Colors are read from the same `--bb-theme-*` custom properties every other
 * chunk in this repo reads (see `assets/controls.ts`) — these are the
 * game's own theme variables, not something this project injects, so they're
 * safe to reference even though `map.tsx` is a standalone script that
 * doesn't depend on `assets.app.js` having run.
 */
const THEME = {
    primary: `var(--bb-theme-primary, #0f0)`,
    primaryDark: `var(--bb-theme-primarydark, #0a0)`,
    secondary: `var(--bb-theme-secondary, #888)`,
    backgroundSecondary: `var(--bb-theme-backgroundsecondary, #0b0f0b)`,
    error: `var(--bb-theme-error, #f55)`,
    warning: `var(--bb-theme-warning, #cc0)`,
    hack: `var(--bb-theme-hack, #8ccf27)`,
    green: `rgb(0, 255, 0)`,
    blue: `rgb(0, 0, 255)`,
    red: `rgb(255, 0, 0)`,
};

const MONOSPACE = `ui-monospace, "SF Mono", Consolas, "Courier New", monospace`;

function formatMoney(amount: number): string {
    return Intl.NumberFormat(undefined, {
        style: "currency",
        currency: "USD",
        currencyDisplay: "narrowSymbol",
        currencySign: "accounting",
        maximumFractionDigits: 3,
    }).format(amount);
}

function parseDisplayFlags(ns: NS) {
    return parseArgs(ns, [
        {
            short: `l`,
            long: `level`,
            defaultValue: false,
            description: `Show each host's required hacking skill`,
        },
        {
            short: `o`,
            long: `organization`,
            defaultValue: false,
            description: `Show each host's owning organization`,
        },
        {
            short: `m`,
            long: `money`,
            defaultValue: false,
            description: `Show each host's available money`,
        },
        {
            short: `r`,
            long: `root`,
            defaultValue: false,
            description: `Show a ROOT badge on hosts you have admin rights on`,
        },
        {
            short: `e`,
            long: `exploits`,
            defaultValue: false,
            description: `Show a badge indicating the number of exploits required`,
        },
        {
            short: `c`,
            long: `cloud`,
            defaultValue: false,
            description: `Show owned cloud servers`,
        },
    ] as const);
}

type DisplayFlags = ReturnType<typeof parseDisplayFlags>;

interface TreeNode {
    host: string;
    /** Hop chain from home to this host (this host included, home excluded) — what `connect`s to type. */
    path: string[];
    server: Server;
    children: TreeNode[];
}

function buildTree(
    ns: NS,
    host: string,
    path: string[],
    showCloud: boolean
): TreeNode {
    const scanned = ns.scan(host);
    const childHosts = host === `home` ? scanned : scanned.slice(1);

    return {
        host,
        path,
        server: ns.getServer(host),
        children: childHosts
            .filter((it) => showCloud || !ns.getServer(it).purchasedByPlayer)
            .map((child) => buildTree(ns, child, [...path, child], showCloud)),
    };
}

/** BFS over `ns.scan` to find the hop-by-hop path from home to `target`, for when `main` is asked to root the tree somewhere other than home. */
function findPathFromHome(ns: NS, target: string): string[] {
    if (target === `home`) {
        return [];
    }

    const visited = new Set<string>([`home`]);
    const queue: { host: string; path: string[] }[] = [
        { host: `home`, path: [] },
    ];

    while (queue.length > 0) {
        const { host, path } = queue.shift()!;
        for (const next of ns.scan(host)) {
            if (visited.has(next)) {
                continue;
            }
            visited.add(next);
            const nextPath = [...path, next];
            if (next === target) {
                return nextPath;
            }
            queue.push({ host: next, path: nextPath });
        }
    }

    return [];
}

/** Terminal command that walks from home to `path`'s last hop, one `connect` per leg. */
function connectCommand(path: string[]): string {
    return [`home`, ...path.map((h) => `connect ${h}`)].join(`; `);
}

interface ConnectLinkProps {
    dom: Dom;
    hostName: string;
    path: string[];
    color: string;
}

function ConnectLink({ dom, hostName, path, color }: ConnectLinkProps) {
    const command = connectCommand(path);

    const onClick = () => {
        const terminalInput = dom.doc.getElementById(`terminal-input`);
        if (!terminalInput) {
            return;
        }

        // A plain `terminalInput.value = command` doesn't touch React's
        // internal value tracker on a controlled input, so `onChange` never
        // fires. Going through the native property setter (bypassing
        // React's own override of `.value`) and then dispatching a real
        // "input" event is the standard way to make a controlled React
        // input pick up a programmatic value change.
        const nativeValueSetter = Object.getOwnPropertyDescriptor(
            dom.win.HTMLInputElement.prototype,
            `value`
        )?.set;
        if (nativeValueSetter) {
            nativeValueSetter.call(terminalInput, command);
        } else {
            terminalInput.value = command;
        }
        terminalInput.dispatchEvent(
            new dom.win.Event(`input`, { bubbles: true })
        );

        // Submitting likewise needs a real KeyboardEvent, not a hand-built
        // object — React derives the SyntheticEvent's key/keyCode from the
        // native event it observes, so a fake object missing a field like
        // `.key` can silently fail to match whatever check the terminal's
        // Enter handler uses.
        //
        // The dispatch is deferred a tick rather than fired immediately
        // after the "input" event above: back-to-back synchronous dispatches
        // outrun React's own state-update flush from that "input" event, so
        // the Enter handler would still see the terminal's *previous* value
        // (e.g. empty) instead of the command chain just set.
        const keyInit = {
            key: `Enter`,
            code: `Enter`,
            keyCode: 13,
            which: 13,
            bubbles: true,
            cancelable: true,
        };
        dom.win.setTimeout(() => {
            terminalInput.dispatchEvent(
                new dom.win.KeyboardEvent(`keydown`, keyInit)
            );
            terminalInput.dispatchEvent(
                new dom.win.KeyboardEvent(`keyup`, keyInit)
            );
        }, 50);
    };

    return (
        <a
            style={{
                color,
                textDecoration: `underline`,
                cursor: `pointer`,
            }}
            onClick={onClick}
        >
            {hostName}
        </a>
    );
}

interface BadgeProps {
    text: string;
    color: string;
}

function Badge({ text, color }: BadgeProps) {
    return (
        <span
            style={{
                display: `inline-block`,
                padding: `0 6px`,
                borderRadius: `999px`,
                fontSize: `9px`,
                lineHeight: `11px`,
                border: `1px solid ${color}`,
                color,
                whiteSpace: `nowrap`,
            }}
        >
            {text}
        </span>
    );
}

interface TreeRowProps {
    dom: Dom;
    node: TreeNode;
    ancestorPrefix: string;
    isLast: boolean;
    isRoot: boolean;
    flags: DisplayFlags;
    playerHackLevel: number;
    exploitCount: number;
}

function nodeColor(
    server: Server,
    playerHackLevel: number,
    exploitCount: number
) {
    if (server.backdoorInstalled) return THEME.green;
    if (server.purchasedByPlayer) return THEME.blue;
    if (
        server.requiredHackingSkill &&
        server.requiredHackingSkill <= playerHackLevel &&
        server.numOpenPortsRequired &&
        server.numOpenPortsRequired <= exploitCount
    )
        return THEME.red;
    return "inherit";
}

/** One row (hostname link + badges) plus, recursively, every row below it — box-drawing connectors instead of the classic `ns.scan` tree's ASCII `\--`. */
function TreeRow({
    dom,
    node,
    ancestorPrefix,
    isLast,
    isRoot,
    flags,
    playerHackLevel,
    exploitCount,
}: TreeRowProps) {
    const { server } = node;
    const connector = isRoot ? `` : ancestorPrefix + (isLast ? `┗━` : `┣━`);
    const childPrefix = ancestorPrefix + (isLast ? `   ` : `┃  `);

    return (
        <>
            <div
                style={{
                    display: `flex`,
                    alignItems: `center`,
                    gap: `6px`,
                    fontWeight: isRoot ? 700 : 400,
                    marginTop: -6,
                }}
            >
                {connector ? (
                    <span style={{ color: THEME.secondary, whiteSpace: `pre` }}>
                        {connector}
                    </span>
                ) : null}
                {isRoot ? (
                    <span style={{ marginRight: `4px` }}>
                        {node.host === `home` ? `🏠` : `🖧`}
                    </span>
                ) : null}
                <ConnectLink
                    dom={dom}
                    hostName={node.host}
                    path={node.path}
                    color={nodeColor(server, playerHackLevel, exploitCount)}
                />
                {flags.level && server.requiredHackingSkill ? (
                    <Badge
                        text={`Lv ${server.requiredHackingSkill}`}
                        color={
                            playerHackLevel >= server.requiredHackingSkill
                                ? THEME.hack
                                : THEME.error
                        }
                    />
                ) : null}
                {flags.exploits && server.numOpenPortsRequired ? (
                    <Badge
                        text={`Ex ${server.numOpenPortsRequired}`}
                        color={
                            exploitCount >= server.numOpenPortsRequired
                                ? THEME.hack
                                : THEME.error
                        }
                    />
                ) : null}
                {flags.organization && server.organizationName ? (
                    <Badge
                        text={server.organizationName}
                        color={THEME.secondary}
                    />
                ) : null}
                {flags.money && server.moneyAvailable ? (
                    <Badge
                        text={formatMoney(server.moneyAvailable)}
                        color={THEME.warning}
                    />
                ) : null}
                {flags.root && server.hasAdminRights ? (
                    <Badge text="ROOT" color={THEME.primary} />
                ) : null}
            </div>
            {node.children.map((child, index) => (
                <TreeRow
                    key={child.host}
                    dom={dom}
                    node={child}
                    ancestorPrefix={childPrefix}
                    isLast={index === node.children.length - 1}
                    isRoot={false}
                    flags={flags}
                    playerHackLevel={playerHackLevel}
                    exploitCount={exploitCount}
                />
            ))}
        </>
    );
}

interface NetworkMapProps {
    dom: Dom;
    root: TreeNode;
    flags: DisplayFlags;
    playerHackLevel: number;
    exploitCount: number;
}

function NetworkMap({
    dom,
    root,
    flags,
    playerHackLevel,
    exploitCount,
}: NetworkMapProps) {
    return (
        <div
            className="un-scale"
            style={{
                display: `inline-block`,
                fontFamily: MONOSPACE,
                fontSize: `16px`,
                color: THEME.primary,
                padding: `8px 12px`,
            }}
        >
            <TreeRow
                dom={dom}
                node={root}
                ancestorPrefix=""
                isLast={true}
                isRoot={true}
                flags={flags}
                playerHackLevel={playerHackLevel}
                exploitCount={exploitCount}
            />
        </div>
    );
}

function printPlainNode(
    ns: NS,
    node: TreeNode,
    ancestorPrefix: string,
    isLast: boolean,
    isRoot: boolean,
    flags: DisplayFlags,
    playerHackLevel: number,
    exploitCount: number
) {
    const connector = isRoot ? `` : ancestorPrefix + (isLast ? `└─ ` : `├─ `);
    const childPrefix = ancestorPrefix + (isLast ? `   ` : `│  `);

    let hostName = node.host;

    if (node.server.backdoorInstalled) hostName = `\x1b[32m${hostName}\x1b[0m`;
    else if (node.server.purchasedByPlayer)
        hostName = `\x1b[35m${hostName}\x1b[0m`;
    else if (
        node.server.requiredHackingSkill &&
        node.server.requiredHackingSkill <= playerHackLevel &&
        node.server.numOpenPortsRequired &&
        node.server.numOpenPortsRequired <= exploitCount
    )
        hostName = `\x1b[31m${hostName}\x1b[0m`;

    const tags: string[] = [];

    if (flags.level && node.server.requiredHackingSkill) {
        tags.push(node.server.requiredHackingSkill.toString());
    }
    if (flags.organization) {
        tags.push(node.server.organizationName);
    }
    if (flags.money && node.server.moneyAvailable) {
        tags.push(formatMoney(node.server.moneyAvailable));
    }
    if (flags.root && node.server.hasAdminRights) {
        tags.push(`$`);
    }
    const suffix = tags.length > 0 ? ` (${tags.join(` - `)})` : ``;

    ns.tprint(`${connector}${hostName}${suffix}`);

    node.children.forEach((child, index) => {
        printPlainNode(
            ns,
            child,
            childPrefix,
            index === node.children.length - 1,
            false,
            flags,
            playerHackLevel,
            exploitCount
        );
    });
}

export async function main(ns: NS) {
    const flags = parseDisplayFlags(ns);

    let host = `home`;
    const args: string[] = ns.args.filter(
        (a): a is string => typeof a === "string" && a[0] != `-`
    );
    if (args.length > 0) {
        host = args[0];
    }

    const exploitCount = [
        `BruteSSH.exe`,
        `SQLInject.exe`,
        `relaySMTP.exe`,
        `FTPCrack.exe`,
        `HTTPWorm.exe`,
    ].filter((p) => ns.fileExists(p, "home")).length;
    ns.tprint(`Exploits: ${exploitCount}`);

    const playerHackLevel = ns.getHackingLevel();

    const root = buildTree(
        ns,
        host,
        findPathFromHome(ns, host),
        flags.showCloud
    );

    const dom = getDomContext(ns);
    if (!dom) {
        printPlainNode(
            ns,
            root,
            ``,
            true,
            true,
            flags,
            playerHackLevel,
            exploitCount
        );
        return;
    }
    ns.tprintRaw(
        <NetworkMap
            dom={dom}
            root={root}
            flags={flags}
            playerHackLevel={playerHackLevel}
            exploitCount={exploitCount}
        />
    );
}
