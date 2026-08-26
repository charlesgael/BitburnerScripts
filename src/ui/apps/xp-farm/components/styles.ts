import { theme } from "../../../utils/theme";

export const buttonStyle = (danger = false, tiny = false) => ({
    minWidth: tiny ? undefined : "70px",
    background: danger ? theme.errorDark : theme.button,
    color: danger ? theme.error : theme.primary,
    border: `1px solid ${danger ? theme.error : theme.primary}`,
    borderRadius: "4px",
    padding: "4px 10px",
    cursor: "pointer",
    fontFamily: "inherit",
    fontSize: "12px",
});
