import { describe, expect, it } from "vitest";
import { getProjectNameEditValue, resolveProjectNameSave } from "./project-settings-name-editor";

describe("project settings name editor", () => {
  it("prefills the original project name when there is no custom name", () => {
    expect(
      getProjectNameEditValue({
        projectName: "acme/repo",
        projectCustomName: null,
      }),
    ).toBe("acme/repo");
  });

  it("does not persist the original name as a custom name when saved unchanged", () => {
    expect(
      resolveProjectNameSave({
        projectName: "acme/repo",
        projectCustomName: null,
        value: "acme/repo",
      }),
    ).toEqual({
      hasChange: false,
      customName: null,
    });
  });
});
