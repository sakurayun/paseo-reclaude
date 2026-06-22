import { useMemo, type MutableRefObject } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, StyleSheet as RNStyleSheet, Text, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import type { GestureType } from "react-native-gesture-handler";
import { NestableScrollContainer } from "react-native-draggable-flatlist";
import { StyleSheet } from "react-native-unistyles";
import { isNative as platformIsNative } from "@/constants/platform";
import { useSidebarSessionsList } from "@/hooks/use-sidebar-sessions-list";
import { SidebarSessionRow } from "@/components/sidebar/sidebar-workspace-sessions";
import { SidebarAgentListSkeleton } from "@/components/sidebar-agent-list-skeleton";

interface SidebarSessionsListProps {
  serverId: string | null;
  /** Native only: keep vertical scroll simultaneous with the sidebar-close pan. */
  parentGestureRef?: MutableRefObject<GestureType | undefined>;
}

/**
 * New-theme default sidebar body: one flat, recency-sorted list of every
 * non-archived session on the active host, with no project/workspace grouping.
 * Sessions auto-refresh through react-query + the live session store, so no
 * manual refresh control is needed here.
 */
export function SidebarSessionsList({ serverId, parentGestureRef }: SidebarSessionsListProps) {
  const { t } = useTranslation();
  const { sessions, isInitialLoad } = useSidebarSessionsList(serverId);

  const nativeScrollGestureProps = useMemo(
    () => (parentGestureRef ? ({ simultaneousHandlers: parentGestureRef } as object) : undefined),
    [parentGestureRef],
  );

  if (isInitialLoad) {
    return <SidebarAgentListSkeleton />;
  }

  if (sessions.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>{t("sidebar.sessionsList.empty")}</Text>
      </View>
    );
  }

  const rows = sessions.map((session) => (
    <SidebarSessionRow
      key={`${session.serverId}:${session.id}`}
      session={session}
      subtitle={session.projectName}
      timeOverride={session.recencyAt}
      variant="flat"
    />
  ));

  return (
    <Animated.View entering={FadeIn.duration(200)} style={a.fill}>
      {platformIsNative ? (
        <NestableScrollContainer
          style={styles.list}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          testID="sidebar-sessions-list-scroll"
          {...nativeScrollGestureProps}
        >
          {rows}
        </NestableScrollContainer>
      ) : (
        <ScrollView
          style={styles.list}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          testID="sidebar-sessions-list-scroll"
        >
          {rows}
        </ScrollView>
      )}
    </Animated.View>
  );
}

const a = RNStyleSheet.create({
  fill: {
    flex: 1,
    minHeight: 0,
  },
});

const styles = StyleSheet.create((theme) => ({
  list: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: theme.spacing[2],
    paddingTop: theme.spacing[1],
    paddingBottom: theme.spacing[4],
  },
  emptyContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: theme.spacing[6],
    paddingVertical: theme.spacing[8],
  },
  emptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
  },
}));
