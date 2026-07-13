import { useEffect } from "react";
import { useHostFeature } from "@/runtime/host-features";
import { useSessionStore } from "@/stores/session-store";
import { useSshUploadStore } from "@/stores/ssh-upload-store";

// Keeps the client mirror of the daemon's SSH upload list live: one-shot list
// on mount, then ssh.uploads.changed snapshots and ssh.uploads.progress
// counters. State lives daemon-side, so progress and cancellation stay in
// sync across every connected client.
export function useSshUploadsSync(serverId: string): { enabled: boolean } {
  const normalizedServerId = serverId.trim();
  const client = useSessionStore((state) =>
    normalizedServerId ? (state.sessions[normalizedServerId]?.client ?? null) : null,
  );
  const enabled = useHostFeature(normalizedServerId, "sshUploads");

  useEffect(() => {
    if (!client || !enabled || !normalizedServerId) {
      return;
    }
    let disposed = false;
    void (async () => {
      try {
        const payload = await client.listSshUploads();
        if (!disposed) {
          useSshUploadStore.getState().setUploads(normalizedServerId, payload.uploads ?? []);
        }
      } catch {
        // The changed broadcast will repopulate once uploads exist.
      }
    })();
    const unsubscribeChanged = client.on("ssh.uploads.changed", (message) => {
      useSshUploadStore.getState().setUploads(normalizedServerId, message.payload.uploads ?? []);
    });
    const unsubscribeProgress = client.on("ssh.uploads.progress", (message) => {
      useSshUploadStore.getState().applyProgress(message.payload);
    });
    return () => {
      disposed = true;
      unsubscribeChanged();
      unsubscribeProgress();
    };
  }, [client, enabled, normalizedServerId]);

  return { enabled };
}
