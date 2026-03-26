const Colors = {
  light: {
    primary: "#006AFF",
    primaryDark: "#0051CC",
    background: "#F2F2F7",
    surface: "#FFFFFF",
    surfaceSecondary: "#F2F2F7",
    text: "#000000",
    textSecondary: "#8E8E93",
    textTertiary: "#C7C7CC",
    border: "#C6C6C8",
    separator: "#E5E5EA",
    green: "#34C759",
    red: "#FF3B30",
    orange: "#FF9500",
    tint: "#006AFF",
    tabIconDefault: "#8E8E93",
    tabIconSelected: "#006AFF",
  },
  dark: {
    primary: "#0A84FF",
    primaryDark: "#0066CC",
    background: "#000000",
    surface: "#1C1C1E",
    surfaceSecondary: "#2C2C2E",
    text: "#FFFFFF",
    textSecondary: "#8E8E93",
    textTertiary: "#48484A",
    border: "#38383A",
    separator: "#38383A",
    green: "#30D158",
    red: "#FF453A",
    orange: "#FF9F0A",
    tint: "#0A84FF",
    tabIconDefault: "#8E8E93",
    tabIconSelected: "#0A84FF",
  },
};

export default Colors;

export type Theme = typeof Colors.light;
