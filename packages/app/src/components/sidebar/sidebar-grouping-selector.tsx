import { useCallback } from "react";
import { Text, View, type PressableStateCallbackType } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Settings2 } from "lucide-react-native";
import type { TFunction } from "i18next";
import type { Theme } from "@/styles/theme";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { useSidebarViewStore, type SidebarGroupMode } from "@/stores/sidebar-view-store";
import { isWeb as platformIsWeb } from "@/constants/platform";

const ThemedSettings2 = withUnistyles(Settings2);
const filterColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

const GROUP_MODE_ITEMS: Array<{ value: SidebarGroupMode; labelKey: string }> = [
  { value: "project", labelKey: "sidebar.grouping.project" },
  { value: "status", labelKey: "sidebar.grouping.status" },
];

export function SidebarGroupingSelector({ serverId }: { serverId: string | null }) {
  const { t } = useTranslation();
  const groupMode = useSidebarViewStore((state) =>
    serverId ? state.getGroupMode(serverId) : "project",
  );
  const setGroupMode = useSidebarViewStore((state) => state.setGroupMode);

  const handleSelect = useCallback(
    (mode: SidebarGroupMode) => {
      if (!serverId) return;
      setGroupMode(serverId, mode);
    },
    [serverId, setGroupMode],
  );

  const triggerStyle = useCallback(
    ({ hovered = false }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.trigger,
      hovered && styles.triggerHovered,
    ],
    [],
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        style={triggerStyle}
        accessibilityRole={platformIsWeb ? undefined : "button"}
        accessibilityLabel={t("sidebar.grouping.accessibilityLabel")}
        testID="sidebar-grouping-selector"
      >
        <ThemedSettings2 size={14} uniProps={filterColorMapping} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" width={180} testID="sidebar-grouping-menu">
        <View style={styles.menuHeader}>
          <Text style={styles.menuHeaderLabel}>{t("sidebar.grouping.groupBy")}</Text>
        </View>
        {GROUP_MODE_ITEMS.map((item) => (
          <GroupModeMenuItem
            key={item.value}
            item={item}
            isSelected={groupMode === item.value}
            onSelect={handleSelect}
            t={t}
          />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function GroupModeMenuItem({
  item,
  isSelected,
  onSelect,
  t,
}: {
  item: { value: SidebarGroupMode; labelKey: string };
  isSelected: boolean;
  onSelect: (mode: SidebarGroupMode) => void;
  t: TFunction;
}) {
  const handleSelect = useCallback(() => onSelect(item.value), [item.value, onSelect]);
  return (
    <DropdownMenuItem
      testID={`sidebar-grouping-${item.value}`}
      selected={isSelected}
      onSelect={handleSelect}
    >
      {t(item.labelKey)}
    </DropdownMenuItem>
  );
}

const styles = StyleSheet.create((theme) => ({
  trigger: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.md,
  },
  triggerHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  menuHeader: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
  },
  menuHeaderLabel: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foregroundMuted,
  },
}));
