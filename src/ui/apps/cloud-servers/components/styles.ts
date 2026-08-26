import { theme } from "../../../utils/theme";

export const fieldStyle = {
    background: theme.well,
    color: theme.primary,
    border: `1px solid ${theme.primary}`,
    borderRadius: "4px",
    padding: "4px",
    fontFamily: "inherit",
};

export const buttonStyle = (danger = false) => ({
    background: danger ? theme.errorDark : theme.button,
    color: danger ? theme.error : theme.primary,
    border: `1px solid ${danger ? theme.error : theme.primary}`,
    borderRadius: "4px",
    padding: "4px 10px",
    cursor: "pointer",
    fontFamily: "inherit",
    fontSize: "12px",
});
