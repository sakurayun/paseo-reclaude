import { useCallback, useMemo, useRef, useState, type ReactElement } from "react";
import { Text, View, type PressableStateCallbackType } from "react-native";
import { Folder } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ProjectIconView } from "@/components/project-icon-view";
import { Combobox, ComboboxItem } from "@/components/ui/combobox";
import type { ComboboxOption } from "@/components/ui/combobox";
import { ComboboxTrigger } from "@/components/ui/combobox-trigger";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { HostProjectListItem } from "@/projects/host-projects";
import { useProjectIconDataByProjectKey } from "@/projects/project-icons";
import { ProjectPickerAddProjectRow } from "@/screens/new-workspace-add-project-row";
import type { Theme } from "@/styles/theme";
import { projectIconPlaceholderLabelFromDisplayName } from "@/utils/project-display-name";

const PROJECT_OPTION_PREFIX = "project:";
const BADGE_HEIGHT = 28;
const PROJECT_ICON_FALLBACK_FONT_SIZE = 10;

const ThemedFolder = withUnistyles(Folder);
const folderUniProps = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
  size: theme.iconSize.sm,
});

function projectOptionId(projectKey: string): string {
  return `${PROJECT_OPTION_PREFIX}${projectKey}`;
}

interface ProjectOptionData {
  options: ComboboxOption[];
  projectByOptionId: Map<string, HostProjectListItem>;
}

function computeProjectOptionData(projects: readonly HostProjectListItem[]): ProjectOptionData {
  const projectByOptionId = new Map<string, HostProjectListItem>();
  const options = projects.map((project) => {
    const id = projectOptionId(project.projectKey);
    projectByOptionId.set(id, project);
    return { id, label: project.projectName };
  });
  return { options, projectByOptionId };
}

/** Args handed to a custom trigger renderer (and the default badge trigger). */
export interface ProjectPickerTriggerArgs {
  /** Anchor ref the dropdown positions itself against; bind it to the pressable. */
  ref: React.RefObject<View | null>;
  /** testID for the trigger pressable. */
  testID: string;
  /** Opens the dropdown. */
  onPress: () => void;
  disabled: boolean;
  /** Selected project name, or "Choose project" when nothing is selected. */
  label: string;
  selectedProject: HostProjectListItem | null;
  /** Data URI for the selected project's icon, if any. */
  iconDataUri: string | null;
}

/** Default trigger: the badge used by the New workspace screen. */
function ProjectPickerBadgeTrigger({
  ref,
  testID,
  onPress,
  disabled,
  label,
  selectedProject,
  iconDataUri,
}: ProjectPickerTriggerArgs): ReactElement {
  const placeholderLabel = projectIconPlaceholderLabelFromDisplayName(label);
  const placeholderInitial = placeholderLabel.charAt(0).toUpperCase() || "?";
  const badgePressableStyle = useCallback(
    ({ pressed, hovered }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.badge,
      Boolean(hovered) && !disabled && styles.badgeHovered,
      pressed && !disabled && styles.badgePressed,
      disabled && styles.badgeDisabled,
    ],
    [disabled],
  );
  return (
    <Tooltip>
      <TooltipTrigger asChild triggerRefProp="ref">
        <ComboboxTrigger
          ref={ref}
          testID={testID}
          onPress={onPress}
          disabled={disabled}
          style={badgePressableStyle}
          accessibilityRole="button"
          accessibilityLabel="Workspace project"
        >
          <View style={styles.badgeIconBox}>
            {selectedProject ? (
              <ProjectIconView
                iconDataUri={iconDataUri}
                initial={placeholderInitial}
                projectKey={selectedProject.projectKey}
                imageStyle={styles.projectIcon}
                fallbackStyle={styles.projectIconFallback}
                textStyle={styles.projectIconFallbackText}
              />
            ) : (
              <ThemedFolder uniProps={folderUniProps} />
            )}
          </View>
          <Text style={styles.badgeText} numberOfLines={1}>
            {label}
          </Text>
        </ComboboxTrigger>
      </TooltipTrigger>
      <TooltipContent side="top" align="center" offset={8}>
        <Text style={styles.tooltipText}>Choose project</Text>
      </TooltipContent>
    </Tooltip>
  );
}

function ProjectOptionItem({
  testID,
  projectKey,
  iconDataUri,
  label,
  description,
  selected,
  active,
  disabled,
  onPress,
}: {
  testID: string;
  projectKey: string;
  iconDataUri: string | null;
  label: string;
  description: string | undefined;
  selected: boolean;
  active: boolean;
  disabled: boolean;
  onPress: () => void;
}): ReactElement {
  const placeholderLabel = projectIconPlaceholderLabelFromDisplayName(label);
  const placeholderInitial = placeholderLabel.charAt(0).toUpperCase() || "?";
  const leadingSlot = useMemo(
    () => (
      <View style={styles.rowIconBox}>
        <ProjectIconView
          iconDataUri={iconDataUri}
          initial={placeholderInitial}
          projectKey={projectKey}
          imageStyle={styles.projectIcon}
          fallbackStyle={styles.projectIconFallback}
          textStyle={styles.projectIconFallbackText}
        />
      </View>
    ),
    [iconDataUri, placeholderInitial, projectKey],
  );

  return (
    <ComboboxItem
      testID={testID}
      label={label}
      description={description}
      selected={selected}
      active={active}
      disabled={disabled}
      onPress={onPress}
      leadingSlot={leadingSlot}
    />
  );
}

export interface ProjectPickerProps {
  serverId: string;
  /** Host projects to choose from (caller supplies; e.g. useHostProjects). */
  projects: readonly HostProjectListItem[];
  /** Currently selected project key, or null for "Choose project". */
  selectedProjectKey: string | null;
  /** Fired with the full project when the user picks one. */
  onSelectProject: (project: HostProjectListItem) => void;
  /** When false, only projects that can host a worktree are selectable. */
  allowAllProjects: boolean;
  disabled?: boolean;
  /**
   * Custom trigger renderer. Defaults to the New-workspace badge. The draft
   * composer passes its frosted-glass pill here so the trigger keeps the glass
   * look while the dropdown reuses this shared project picker.
   */
  renderTrigger?: (args: ProjectPickerTriggerArgs) => ReactElement;
  /** testID prefix for the trigger (`-trigger`) and options (`-option-<key>`). */
  testIDPrefix?: string;
  /** Desktop dropdown placement relative to the trigger; defaults to opening downward. */
  desktopPlacement?: "top-start" | "bottom-start";
}

/**
 * Shared "Choose project" control: a trigger plus a searchable dropdown of host
 * projects with an "Add project" action. The New workspace screen and the draft
 * composer's working-directory selector both render this so the two stay in sync.
 */
export function ProjectPicker({
  serverId,
  projects,
  selectedProjectKey,
  onSelectProject,
  allowAllProjects,
  disabled = false,
  renderTrigger,
  testIDPrefix = "project-picker",
  desktopPlacement = "bottom-start",
}: ProjectPickerProps): ReactElement {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<View>(null);
  const projectIconDataByProjectKey = useProjectIconDataByProjectKey({ serverId, projects });

  const selectableProjects = useMemo(
    () => (allowAllProjects ? projects : projects.filter((project) => project.canCreateWorktree)),
    [allowAllProjects, projects],
  );
  const { options, projectByOptionId } = useMemo(
    () => computeProjectOptionData(selectableProjects),
    [selectableProjects],
  );
  const selectedProject = useMemo(
    () => projects.find((project) => project.projectKey === selectedProjectKey) ?? null,
    [projects, selectedProjectKey],
  );
  const selectedOptionId = selectedProject ? projectOptionId(selectedProject.projectKey) : "";
  const label = selectedProject?.projectName ?? "Choose project";

  const openPicker = useCallback(() => setOpen(true), []);
  const closePicker = useCallback(() => setOpen(false), []);
  const handleOpenChange = useCallback((next: boolean) => setOpen(next), []);

  const handleSelect = useCallback(
    (id: string) => {
      const project = projectByOptionId.get(id);
      if (!project) return;
      if (!allowAllProjects && !project.canCreateWorktree) return;
      onSelectProject(project);
      setOpen(false);
    },
    [allowAllProjects, onSelectProject, projectByOptionId],
  );

  const renderOption = useCallback(
    ({
      option,
      selected,
      active,
      onPress,
    }: {
      option: ComboboxOption;
      selected: boolean;
      active: boolean;
      onPress: () => void;
    }) => {
      const project = projectByOptionId.get(option.id);
      if (!project) return <View key={option.id} />;
      return (
        <ProjectOptionItem
          testID={`${testIDPrefix}-option-${project.projectKey}`}
          projectKey={project.projectKey}
          iconDataUri={projectIconDataByProjectKey.get(project.projectKey) ?? null}
          label={project.projectName}
          description={project.iconWorkingDir}
          selected={selected}
          active={active}
          disabled={disabled || (!allowAllProjects && !project.canCreateWorktree)}
          onPress={onPress}
        />
      );
    },
    [allowAllProjects, disabled, projectByOptionId, projectIconDataByProjectKey, testIDPrefix],
  );

  const listHeader = useMemo(
    () => <ProjectPickerAddProjectRow serverId={serverId} onActivate={closePicker} />,
    [closePicker, serverId],
  );

  const triggerArgs: ProjectPickerTriggerArgs = {
    ref: anchorRef,
    testID: `${testIDPrefix}-trigger`,
    onPress: openPicker,
    disabled: disabled || options.length === 0,
    label,
    selectedProject,
    iconDataUri: selectedProject
      ? (projectIconDataByProjectKey.get(selectedProject.projectKey) ?? null)
      : null,
  };

  return (
    <View>
      {(renderTrigger ?? ((args) => <ProjectPickerBadgeTrigger {...args} />))(triggerArgs)}
      <Combobox
        options={options}
        value={selectedOptionId}
        onSelect={handleSelect}
        searchable
        searchPlaceholder="Search projects"
        title="Project"
        open={open}
        onOpenChange={handleOpenChange}
        desktopPlacement={desktopPlacement}
        anchorRef={anchorRef}
        emptyText="No projects available."
        renderOption={renderOption}
        listHeader={listHeader}
      />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    height: BADGE_HEIGHT,
    maxWidth: 240,
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius["2xl"],
    gap: theme.spacing[1],
  },
  badgeHovered: {
    backgroundColor: theme.colors.surface2,
  },
  badgePressed: {
    backgroundColor: theme.colors.surface0,
  },
  badgeDisabled: {
    opacity: 0.6,
  },
  badgeText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    flexShrink: 1,
  },
  tooltipText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.popoverForeground,
  },
  badgeIconBox: {
    width: theme.iconSize.md,
    height: theme.iconSize.md,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  projectIcon: {
    width: theme.iconSize.md,
    height: theme.iconSize.md,
    borderRadius: theme.borderRadius.sm,
  },
  projectIconFallback: {
    width: theme.iconSize.md,
    height: theme.iconSize.md,
    borderRadius: theme.borderRadius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  projectIconFallbackText: {
    fontSize: PROJECT_ICON_FALLBACK_FONT_SIZE,
    fontWeight: "600",
  },
  rowIconBox: {
    width: theme.iconSize.md,
    height: theme.iconSize.md,
    alignItems: "center",
    justifyContent: "center",
  },
}));
