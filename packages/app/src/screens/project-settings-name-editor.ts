interface ProjectNameEditInput {
  projectName: string;
  projectCustomName?: string | null;
}

interface ProjectNameSaveInput {
  projectName: string;
  projectCustomName?: string | null;
  value: string;
}

export interface ProjectNameSaveResolution {
  hasChange: boolean;
  customName: string | null;
}

export function getProjectNameEditValue(project: ProjectNameEditInput): string {
  return project.projectCustomName ?? project.projectName;
}

export function resolveProjectNameSave(input: ProjectNameSaveInput): ProjectNameSaveResolution {
  const currentCustomName = input.projectCustomName ?? null;
  const trimmed = input.value.trim();
  let customName = trimmed.length === 0 ? null : trimmed;
  if (currentCustomName === null && customName === input.projectName) {
    customName = null;
  }
  return {
    hasChange: customName !== currentCustomName,
    customName,
  };
}
