import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { SshUploadDropSheet } from "@/components/ssh/ssh-upload-drop-sheet";
import { useHostFeature } from "@/runtime/host-features";
import { useSshHosts } from "@/screens/ssh/use-ssh-hosts";
import { useSessionStore } from "@/stores/session-store";
import { useSshUploadStore } from "@/stores/ssh-upload-store";
import {
  enumerateDroppedItems,
  type EnumeratedDrop,
  type TerminalEmulatorFileDrop,
} from "@/terminal/drop/enumerate-dropped-entries";
import { startSshUpload } from "@/ssh/upload/ssh-upload-sender";

interface DropPromptState {
  pasteText: string | null;
  enumerated: EnumeratedDrop | null;
  error: string | null;
  busy: boolean;
}

export interface UseSshTerminalFileDropResult {
  // Handed to TerminalEmulator; returns true when the drop was intercepted
  // (SSH terminal + sshUploads-capable daemon). Undefined keeps the default
  // paste-paths behavior for local terminals and old daemons.
  onFileDrop: ((drop: TerminalEmulatorFileDrop) => boolean) | undefined;
  sheet: ReactNode;
}

// Drop-on-SSH-terminal orchestration: intercepts the emulator's file drop,
// shows the paste-or-upload choice sheet, and hands the upload off to the
// SFTP sender (which auto-opens the uploads panel).
export function useSshTerminalFileDrop(input: {
  serverId: string;
  terminalId: string;
  hostId: string | null;
  pasteToTerminal: (data: string) => void;
}): UseSshTerminalFileDropResult {
  const { serverId, terminalId, hostId, pasteToTerminal } = input;
  const { t } = useTranslation();
  const uploadsEnabled = useHostFeature(serverId, "sshUploads");
  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);
  const { hosts } = useSshHosts(hostId ? serverId : null);
  const [prompt, setPrompt] = useState<DropPromptState | null>(null);
  // A new drop invalidates the async enumeration of the previous one.
  const dropSequenceRef = useRef(0);
  const destDirRef = useRef<string>("~");

  const host = useMemo(
    () => (hostId ? (hosts.find((entry) => entry.id === hostId) ?? null) : null),
    [hostId, hosts],
  );
  // Mosh/FIDO2 hosts run through the system ssh binary — no pooled ssh2
  // connection, so SFTP upload is unavailable for them.
  const sftpUnavailable = Boolean(host && (host.mosh?.enabled || host.useFido2));

  const active = Boolean(hostId && uploadsEnabled && client);

  const handleFileDrop = useCallback(
    (drop: TerminalEmulatorFileDrop): boolean => {
      if (!hostId) {
        return false;
      }
      const sequence = ++dropSequenceRef.current;
      destDirRef.current = useSshUploadStore.getState().lastDestDirByHost[hostId] ?? "~";
      setPrompt({ pasteText: drop.pasteText, enumerated: null, error: null, busy: false });
      void (async () => {
        const enumerated = await enumerateDroppedItems(drop.items);
        if (dropSequenceRef.current !== sequence) {
          return;
        }
        setPrompt((current) => (current ? { ...current, enumerated } : current));
      })();
      return true;
    },
    [hostId],
  );

  const handleClose = useCallback(() => {
    dropSequenceRef.current += 1;
    setPrompt(null);
  }, []);

  const handlePaste = useCallback(() => {
    const pasteText = prompt?.pasteText;
    setPrompt(null);
    if (pasteText) {
      pasteToTerminal(pasteText);
    }
  }, [pasteToTerminal, prompt]);

  const handleChangeDestDir = useCallback((destDir: string) => {
    destDirRef.current = destDir;
  }, []);

  const handleUpload = useCallback(() => {
    if (!client || !hostId || !prompt?.enumerated || prompt.enumerated.files.length === 0) {
      return;
    }
    const destDir = destDirRef.current.trim() || "~";
    const files = prompt.enumerated.files;
    setPrompt((current) => (current ? { ...current, busy: true, error: null } : current));
    void (async () => {
      const result = await startSshUpload({ client, serverId, hostId, terminalId, destDir, files });
      if (result.ok) {
        const store = useSshUploadStore.getState();
        store.setLastDestDir(hostId, destDir);
        store.openPanel();
        setPrompt(null);
        return;
      }
      const message =
        result.code === "sftp_unavailable"
          ? t("ssh.uploads.dropSheet.sftpUnavailable")
          : t("ssh.uploads.dropSheet.uploadFailed", { error: result.error });
      setPrompt((current) => (current ? { ...current, busy: false, error: message } : current));
    })();
  }, [client, hostId, prompt, serverId, t, terminalId]);

  const sheet =
    active && prompt ? (
      <SshUploadDropSheet
        visible
        hostLabel={host?.label ?? hostId ?? ""}
        pasteText={prompt.pasteText}
        enumerated={prompt.enumerated}
        canUpload={!sftpUnavailable}
        uploadDisabledReason={sftpUnavailable ? t("ssh.uploads.dropSheet.sftpUnavailable") : null}
        initialDestDir={destDirRef.current}
        error={prompt.error}
        busy={prompt.busy}
        onChangeDestDir={handleChangeDestDir}
        onPaste={handlePaste}
        onUpload={handleUpload}
        onClose={handleClose}
      />
    ) : null;

  return {
    onFileDrop: active ? handleFileDrop : undefined,
    sheet,
  };
}
