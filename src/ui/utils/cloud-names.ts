/**
 * Themed fallback names for purchased ("cloud") servers, in the spirit of
 * Android's candy codenames or Ubuntu's animal ones — used by the Cloud
 * Servers app when the player leaves the hostname field blank instead of
 * refusing to buy. Pure data/client logic, no `ns.*` calls, so it's free to
 * import into `ui.app.js`'s reachable code (see `ui/apps/cloud-servers.tsx`'s
 * header comment on why that distinction matters here).
 */
const CANDY_NAMES = [
    "cupcake",
    "donut",
    "eclair",
    "froyo",
    "gingerbread",
    "honeycomb",
    "icecream",
    "jellybean",
    "kitkat",
    "lollipop",
    "marshmallow",
    "nougat",
    "oreo",
    "pie",
    "gumdrop",
    "toffee",
    "praline",
    "truffle",
    "caramel",
    "licorice",
    "fudge",
    "brittle",
    "taffy",
    "lemondrop",
    "peppermint",
    "butterscotch",
    "gumball",
    "skittle",
    "twizzler",
    "wafer",
    "sherbet",
    "meringue",
    "marzipan",
    "brownie",
    "cookie",
    "pretzel",
    "waffle",
    "biscuit",
    "sundae",
    "popsicle",
];

/**
 * Picks a random name for a new cloud server. Prefers a name not already in
 * `existingHostnames` (case-insensitive), so distinct purchases usually get
 * distinct names at a glance — though it's not load-bearing: `purchaseServer`
 * itself auto-suffixes (`foo` -> `foo-0`, `foo-1`, ...) on a collision, so
 * falling back to a random pick once every themed name is taken is fine.
 */
export function pickCloudServerName(existingHostnames: string[]): string {
    const used = new Set(existingHostnames.map((h) => h.toLowerCase()));
    const available = CANDY_NAMES.filter((name) => !used.has(name));
    const pool = available.length > 0 ? available : CANDY_NAMES;
    return pool[Math.floor(Math.random() * pool.length)];
}
