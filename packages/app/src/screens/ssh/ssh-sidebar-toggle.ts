import type { ActiveWorkspaceSelection } from "@/stores/navigation-active-workspace-store";

// Where the main panel should return when the sidebar SSH entry is tapped a
// second time (exiting SSH mode): the workspace that was active when SSH mode
// was entered, falling back to the last active workspace. Only applies while
// the main panel is parked on the /ssh manager page — anywhere else the toggle
// just flips the sidebar body back and must not yank navigation.
export function resolveSshExitWorkspace(input: {
  pathname: string;
  entrySelection: ActiveWorkspaceSelection | null;
  lastSelection: ActiveWorkspaceSelection | null;
}): ActiveWorkspaceSelection | null {
  if (!input.pathname.startsWith("/ssh")) {
    return null;
  }
  return input.entrySelection ?? input.lastSelection;
}
