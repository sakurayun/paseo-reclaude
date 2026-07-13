import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { SshUpload, SshUploadsProgress } from "@getpaseo/protocol/messages";

// Client mirror of the daemon's SSH upload state (see ssh-upload-runtime.ts).
// Uploads live on the daemon and arrive via ssh.uploads.changed snapshots plus
// high-frequency ssh.uploads.progress counters, so every connected client sees
// the same list and can cancel from anywhere. Only the per-host destination
// memory persists; upload state is transient by design.

export interface SshUploadFileProgress {
  bytesReceived: number;
  bytesWritten: number;
}

interface SshUploadStoreState {
  uploadsByServer: Record<string, SshUpload[]>;
  // uploadId -> fileId -> live counters from ssh.uploads.progress.
  progressByUpload: Record<string, Record<string, SshUploadFileProgress>>;
  panelOpen: boolean;
  // `${uploadId}:${dirPath}` keys of collapsed tree directories.
  collapsedDirs: Record<string, boolean>;
  // hostId -> last used destination directory (persisted).
  lastDestDirByHost: Record<string, string>;
  setUploads: (serverId: string, uploads: SshUpload[]) => void;
  upsertUpload: (serverId: string, upload: SshUpload) => void;
  applyProgress: (payload: SshUploadsProgress["payload"]) => void;
  openPanel: () => void;
  closePanel: () => void;
  toggleCollapsedDir: (key: string) => void;
  setLastDestDir: (hostId: string, destDir: string) => void;
}

function pruneProgress(
  progress: Record<string, Record<string, SshUploadFileProgress>>,
  uploads: SshUpload[],
): Record<string, Record<string, SshUploadFileProgress>> {
  const liveIds = new Set(uploads.map((upload) => upload.uploadId));
  let changed = false;
  const next: Record<string, Record<string, SshUploadFileProgress>> = {};
  for (const [uploadId, entry] of Object.entries(progress)) {
    if (liveIds.has(uploadId)) {
      next[uploadId] = entry;
    } else {
      changed = true;
    }
  }
  return changed ? next : progress;
}

export const useSshUploadStore = create<SshUploadStoreState>()(
  persist(
    (set) => ({
      uploadsByServer: {},
      progressByUpload: {},
      panelOpen: false,
      collapsedDirs: {},
      lastDestDirByHost: {},
      setUploads: (serverId, uploads) =>
        set((state) => ({
          uploadsByServer: { ...state.uploadsByServer, [serverId]: uploads },
          progressByUpload: pruneProgress(state.progressByUpload, uploads),
        })),
      upsertUpload: (serverId, upload) =>
        set((state) => {
          const existing = state.uploadsByServer[serverId] ?? [];
          const index = existing.findIndex((entry) => entry.uploadId === upload.uploadId);
          const next =
            index >= 0
              ? existing.map((entry) => (entry.uploadId === upload.uploadId ? upload : entry))
              : [...existing, upload];
          return { uploadsByServer: { ...state.uploadsByServer, [serverId]: next } };
        }),
      applyProgress: (payload) =>
        set((state) => {
          const current = state.progressByUpload[payload.uploadId] ?? {};
          const entry = { ...current };
          for (const file of payload.files) {
            entry[file.id] = {
              bytesReceived: file.bytesReceived,
              bytesWritten: file.bytesWritten,
            };
          }
          return {
            progressByUpload: { ...state.progressByUpload, [payload.uploadId]: entry },
          };
        }),
      openPanel: () => set({ panelOpen: true }),
      closePanel: () => set({ panelOpen: false }),
      toggleCollapsedDir: (key) =>
        set((state) => ({
          collapsedDirs: { ...state.collapsedDirs, [key]: !state.collapsedDirs[key] },
        })),
      setLastDestDir: (hostId, destDir) =>
        set((state) => ({
          lastDestDirByHost: { ...state.lastDestDirByHost, [hostId]: destDir },
        })),
    }),
    {
      name: "ssh-upload-prefs",
      storage: createJSONStorage(() => AsyncStorage),
      // Upload/progress state is transient daemon state; only preferences persist.
      partialize: (state) => ({ lastDestDirByHost: state.lastDestDirByHost }),
    },
  ),
);

const EMPTY_UPLOADS: SshUpload[] = [];

export function useSshUploads(serverId: string | null): SshUpload[] {
  return useSshUploadStore((state) =>
    serverId ? (state.uploadsByServer[serverId] ?? EMPTY_UPLOADS) : EMPTY_UPLOADS,
  );
}

export function getSshUpload(serverId: string, uploadId: string): SshUpload | null {
  const uploads = useSshUploadStore.getState().uploadsByServer[serverId] ?? [];
  return uploads.find((upload) => upload.uploadId === uploadId) ?? null;
}
