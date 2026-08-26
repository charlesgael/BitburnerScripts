import { theme } from "../../../utils/theme";

/** Shared inline-style helpers for every File Explorer screen/component. */
export const buttonStyle = (danger = false) => ({
    background: danger ? theme.errorDark : theme.button,
    color: danger ? theme.error : theme.primary,
    border: `1px solid ${danger ? theme.error : theme.primary}`,
    borderRadius: "4px",
    padding: "4px 8px",
    cursor: "pointer",
    fontFamily: "inherit",
    fontSize: "11px",
    whiteSpace: "nowrap" as const,
});

export const fieldStyle = {
    background: theme.well,
    color: theme.primary,
    border: `1px solid ${theme.primary}`,
    borderRadius: "4px",
    padding: "4px",
    fontFamily: "inherit",
    fontSize: "11px",
    width: "100%",
    boxSizing: "border-box" as const,
};
