import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { ProjectAddResponse } from "@getpaseo/protocol/messages";
import {
  normalizeEmptyProjectDescriptor as normalizeProjectWithoutWorkspacesDescriptor,
  type EmptyProjectDescriptor as ProjectWithoutWorkspacesDescriptor,
} from "@/stores/session-store";

type OpenProjectPayload = ProjectAddResponse["payload"];
type OpenProjectErrorCode = NonNullable<OpenProjectPayload["errorCode"]>;

export interface OpenProjectSuccess {
  ok: true;
  /**
   * Identifies the registered project. `projectKey` matches the host project
   * list's key (so callers can preselect it), and `projectRootPath` is its
   * canonical root — both are needed to deep-link into the New workspace screen.
   */
  projectKey: string;
  projectRootPath: string;
}

export interface OpenProjectFailure {
  ok: false;
  errorCode: OpenProjectErrorCode | null;
  error: string | null;
}

export type OpenProjectResult = OpenProjectSuccess | OpenProjectFailure;
export type OpenProjectFailureReason = "directory_not_found" | "open_failed";

export function getOpenProjectFailureReason(
  result: OpenProjectResult,
): OpenProjectFailureReason | null {
  if (result.ok) {
    return null;
  }

  if (result.errorCode === "directory_not_found") {
    return "directory_not_found";
  }

  return "open_failed";
}

export interface OpenProjectDirectlyInput {
  serverId: string;
  projectPath: string;
  isConnected: boolean;
  canAddProject: boolean;
  client: Pick<DaemonClient, "addProject"> | null;
  addEmptyProject: (serverId: string, project: ProjectWithoutWorkspacesDescriptor) => void;
  setHasHydratedWorkspaces: (serverId: string, hydrated: boolean) => void;
}

export async function openProjectDirectly(
  input: OpenProjectDirectlyInput,
): Promise<OpenProjectResult> {
  const normalizedServerId = input.serverId.trim();
  const trimmedPath = input.projectPath.trim();
  if (!normalizedServerId || !trimmedPath || !input.client || !input.isConnected) {
    return { ok: false, errorCode: null, error: null };
  }

  if (!input.canAddProject) {
    return {
      ok: false,
      errorCode: null,
      error: "Update the host to add projects without creating a workspace.",
    };
  }

  const payload = await input.client.addProject(trimmedPath);
  if (payload.error || !payload.project) {
    return {
      ok: false,
      errorCode: payload.errorCode ?? null,
      error: payload.error,
    };
  }

  const project = normalizeProjectWithoutWorkspacesDescriptor(payload.project);
  input.addEmptyProject(normalizedServerId, project);
  input.setHasHydratedWorkspaces(normalizedServerId, true);
  // projectKey === projectId for empty (workspace-less) projects — see
  // workspace-structure's emptyProject branch.
  return { ok: true, projectKey: project.projectId, projectRootPath: project.projectRootPath };
}
