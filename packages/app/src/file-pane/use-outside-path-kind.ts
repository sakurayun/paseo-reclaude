import { useEffect, useState } from "react";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { classifyWorkspacePath } from "@/workspace/classify-workspace-path";
import type { OutsidePathKind } from "./outside-path";

export function useOutsidePathKind(input: {
  client: DaemonClient | null;
  workspaceRoot: string;
  outsideAbsolutePath: string | null;
}): OutsidePathKind | null {
  const [kind, setKind] = useState<OutsidePathKind | null>(null);

  useEffect(() => {
    if (!input.outsideAbsolutePath || !input.client) {
      setKind(null);
      return;
    }

    let active = true;
    setKind("unknown");
    const client = input.client;
    const absolutePath = input.outsideAbsolutePath;
    const workspaceRoot = input.workspaceRoot;

    void (async () => {
      const classified = await classifyWorkspacePath({
        listDirectory: (root, path) => client.listDirectory(root, path),
        workspaceRoot,
        path: absolutePath,
      });
      if (!active) {
        return;
      }
      if (classified?.kind === "absolute-directory") {
        setKind("directory");
        return;
      }
      if (classified?.kind === "absolute-file") {
        setKind("file");
        return;
      }
      setKind("unknown");
    })();

    return () => {
      active = false;
    };
  }, [input.client, input.outsideAbsolutePath, input.workspaceRoot]);

  return kind;
}
