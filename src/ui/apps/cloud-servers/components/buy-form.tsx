import { theme, wrapText } from "../../../utils/theme";
import { CloudServersState } from "../logic/use-cloud-servers";
import { formatMoney } from "../logic/format-money";
import { fieldStyle, buttonStyle } from "./styles";

/** The purchase form: hostname (blank = random), RAM tier picker, and the
 * Buy button. */
export function BuyForm({ React, cs }: { React: any; cs: CloudServersState }) {
    return (
        <div style={{ paddingTop: "10px" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "12px", marginBottom: "8px" }}>
                Hostname
                <input
                    type="text"
                    value={cs.buyHostname}
                    placeholder="blank = random name"
                    disabled={cs.busy || cs.atServerLimit}
                    onChange={(ev: any) => cs.setBuyHostname(ev.target.value)}
                    style={fieldStyle}
                />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "12px", marginBottom: "8px" }}>
                RAM
                <select
                    value={cs.buyRam}
                    disabled={cs.busy || cs.atServerLimit || cs.ramTiers.length === 0}
                    onChange={(ev: any) => cs.setBuyRam(Number(ev.target.value))}
                    style={fieldStyle}
                >
                    {cs.ramTiers.map((ram) => (
                        <option key={ram} value={ram} disabled={cs.costByRam[ram] > cs.moneyAvailable}>
                            {ram} GB — {formatMoney(cs.costByRam[ram])}
                        </option>
                    ))}
                </select>
            </label>
            {cs.atServerLimit ? (
                <div style={{ color: theme.error, fontSize: "11px", marginBottom: "8px", ...wrapText }}>
                    Server limit reached ({cs.serverLimit}). Delete one to buy another.
                </div>
            ) : null}
            {cs.buyError ? (
                <div style={{ color: theme.error, fontSize: "11px", marginBottom: "8px", ...wrapText }}>{cs.buyError}</div>
            ) : null}
            <button
                onClick={() => void cs.handleBuy()}
                disabled={cs.buyDisabled}
                title={cs.insufficientMoney ? "Not enough money" : undefined}
                style={{
                    ...buttonStyle(),
                    width: "100%",
                    opacity: cs.buyDisabled ? 0.6 : 1,
                    cursor: cs.buyDisabled ? "default" : "pointer",
                }}
            >
                {cs.buyBusy ? "..." : `Buy (${formatMoney(cs.selectedCost)})`}
            </button>
        </div>
    );
}
