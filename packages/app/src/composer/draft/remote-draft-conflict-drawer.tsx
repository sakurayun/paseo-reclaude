import { useCallback, useMemo, useState, type ReactElement } from "react";
import { Pressable, ScrollView, Text, View, type PressableStateCallbackType } from "react-native";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight, CloudDownload } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { GlassSurface } from "@/components/ui/glass-surface";
import { MAX_CONTENT_WIDTH } from "@/constants/layout";
import type { Theme } from "@/styles/theme";

const ThemedChevronDown = withUnistyles(ChevronDown);
const ThemedChevronRight = withUnistyles(ChevronRight);
const ThemedCloudDownload = withUnistyles(CloudDownload);

const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const accentColorMapping = (theme: Theme) => ({ color: theme.colors.accent });

const CONTENT_MAX_HEIGHT = 160;

export interface RemoteDraftConflictDrawerProps {
  /** Remote draft text that diverges from the local in-progress edit. */
  remoteText: string;
  /** Overwrite the local input with the remote text and dismiss the conflict. */
  onAccept: () => void;
}

/**
 * A todo-track-style drawer above the composer that surfaces a remote draft which
 * diverges from what the user is typing. Collapsed it shows a one-line preview;
 * expanded it shows the full remote text (which updates live as the peer keeps
 * typing, and disappears when the peer sends/clears) plus an "overwrite local"
 * action. It never touches the local input until the user accepts.
 */
export function RemoteDraftConflictDrawer({
  remoteText,
  onAccept,
}: RemoteDraftConflictDrawerProps): ReactElement {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const toggleExpanded = useCallback(() => setExpanded((current) => !current), []);

  const surfaceStyle = useMemo(
    () => [styles.surface, expanded && styles.surfaceExpanded],
    [expanded],
  );
  const headerStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.header,
      !expanded && styles.headerCollapsed,
      (hovered || pressed) && styles.headerActive,
    ],
    [expanded],
  );

  return (
    <View style={styles.outer} testID="remote-draft-conflict-drawer">
      <View style={styles.track}>
        <GlassSurface backdropStyle={styles.surfaceBackdrop} style={surfaceStyle}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("composer.draftConflict.title")}
            testID="remote-draft-conflict-header"
            onPress={toggleExpanded}
            style={headerStyle}
          >
            {expanded ? (
              <ThemedChevronDown size={12} uniProps={foregroundMutedColorMapping} />
            ) : (
              <ThemedChevronRight size={12} uniProps={foregroundMutedColorMapping} />
            )}
            <ThemedCloudDownload size={12} uniProps={accentColorMapping} />
            <Text style={styles.headerTitle}>{t("composer.draftConflict.title")}</Text>
            <Text style={styles.headerPreview} numberOfLines={1}>
              {remoteText}
            </Text>
          </Pressable>
          {expanded ? (
            <View style={styles.body}>
              <ScrollView
                style={styles.scroll}
                contentContainerStyle={styles.scrollContent}
                showsVerticalScrollIndicator={false}
                nestedScrollEnabled
              >
                <Text style={styles.bodyText} selectable>
                  {remoteText}
                </Text>
              </ScrollView>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("composer.draftConflict.overwrite")}
                testID="remote-draft-conflict-accept"
                onPress={onAccept}
                style={styles.acceptButton}
              >
                <Text style={styles.acceptText}>{t("composer.draftConflict.overwrite")}</Text>
              </Pressable>
            </View>
          ) : null}
        </GlassSurface>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  outer: {
    width: "100%",
    alignItems: "center",
    paddingHorizontal: theme.spacing[4],
  },
  track: {
    width: "100%",
    maxWidth: MAX_CONTENT_WIDTH,
    marginBottom: -theme.spacing[4],
  },
  surface: {
    alignSelf: "stretch",
    borderTopLeftRadius: theme.borderRadius["2xl"],
    borderTopRightRadius: theme.borderRadius["2xl"],
    overflow: "hidden",
  },
  surfaceBackdrop: {
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderTopLeftRadius: theme.borderRadius["2xl"],
    borderTopRightRadius: theme.borderRadius["2xl"],
    overflow: "hidden",
  },
  surfaceExpanded: {
    paddingBottom: theme.spacing[4],
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
  },
  headerCollapsed: {
    paddingBottom: theme.spacing[6],
  },
  headerActive: {
    backgroundColor: theme.colors.surface2,
  },
  headerTitle: {
    flexShrink: 0,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  headerPreview: {
    flexShrink: 1,
    minWidth: 0,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foreground,
  },
  body: {
    paddingHorizontal: theme.spacing[3],
  },
  scroll: {
    maxHeight: CONTENT_MAX_HEIGHT,
  },
  scrollContent: {
    paddingVertical: theme.spacing[1],
  },
  bodyText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
    lineHeight: theme.fontSize.sm * 1.4,
  },
  acceptButton: {
    marginTop: theme.spacing[2],
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.accent,
    alignItems: "center",
  },
  acceptText: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.primaryForeground,
  },
}));
