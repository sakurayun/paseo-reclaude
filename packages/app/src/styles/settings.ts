import { StyleSheet } from "react-native-unistyles";

export const settingsStyles = StyleSheet.create((theme) => ({
  section: {
    marginBottom: theme.spacing[6],
  },
  sectionHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: theme.spacing[3],
    marginLeft: theme.spacing[1],
  },
  sectionTitle: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.normal,
    marginBottom: theme.spacing[3],
    marginLeft: theme.spacing[1],
  },
  sectionHeaderTitle: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.normal,
  },
  sectionHeaderLink: {
    alignItems: "center",
    flexDirection: "row",
    gap: theme.spacing[1],
  },
  sectionHeaderLinkText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  // Borderless nested-card look (fork): a "card" is no longer a single bordered
  // box. It's now a transparent vertical stack, and each row inside becomes its
  // own rounded surface — like the home message stream's #fafafa bubbles on the
  // white content area — separated by gap instead of divider lines. The many
  // existing `<View style={settingsStyles.card}>` call sites keep working: the
  // rows they wrap turn into independent cards automatically. See
  // docs/new-theme.md.
  card: {
    gap: theme.spacing[2],
  },
  // A single rounded surface panel for custom (non-row) card content: empty /
  // loading states, text areas, code blocks, bespoke lists — anything that isn't
  // a `settingsStyles.row`. Same borderless surface as a row, without the row
  // padding/layout so the content brings its own.
  cardSurface: {
    backgroundColor: theme.colors.surface1,
    borderRadius: theme.borderRadius.xl,
    ...theme.shadow.sm,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: theme.spacing[4],
    paddingHorizontal: theme.spacing[4],
    backgroundColor: theme.colors.surface1,
    borderRadius: theme.borderRadius.xl,
    ...theme.shadow.sm,
  },
  // Divider between rows is gone in the nested-card look — rows are separated by
  // the card stack's gap. Kept as a no-op so the `[row, rowBorder]` call sites
  // stay valid without per-file edits.
  rowBorder: {},
  rowContent: {
    flex: 1,
    marginRight: theme.spacing[3],
  },
  rowTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  rowHint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    marginTop: theme.spacing[1],
  },
}));
