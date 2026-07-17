import React, { useCallback } from "react";
import { Text, View } from "react-native";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Switch } from "@/components/ui/switch";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { settingsStyles } from "@/styles/settings";
import {
  createBrowserToolsPatch,
  getBrowserToolsCardState,
  getBrowserToolsMutationViewState,
} from "./browser-tools-config";

export function BrowserToolsOptInCard({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const isConnected = useHostRuntimeIsConnected(serverId);
  const { config, patchConfig } = useDaemonConfig(serverId);
  const state = getBrowserToolsCardState({ isConnected, config });
  const mutation = useMutation({
    mutationFn: async (next: boolean) => {
      const result = await patchConfig(createBrowserToolsPatch(next));
      if (!result) {
        throw new Error(t("workspace.terminal.hostDisconnected"));
      }
      return result;
    },
  });
  const mutationView = getBrowserToolsMutationViewState({
    isPending: mutation.isPending,
    error: mutation.error,
  });

  const handleValueChange = useCallback(
    (next: boolean) => {
      mutation.mutate(next);
    },
    [mutation],
  );

  if (!state.isVisible) return null;

  const title = t("settings.host.browserTools.title");
  const warning = t("settings.host.browserTools.hint");

  return (
    <View style={settingsStyles.card} testID="host-page-browser-tools-card">
      <View style={settingsStyles.row}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>{title}</Text>
          <Text style={settingsStyles.rowHint}>{warning}</Text>
          {mutationView.isLoading ? (
            <Text style={settingsStyles.rowHint} testID="host-page-browser-tools-loading">
              {t("settings.host.browserTools.updating")}
            </Text>
          ) : null}
          {mutationView.hasError && mutationView.errorMessage ? (
            <Text style={settingsStyles.rowError} testID="host-page-browser-tools-error">
              {mutationView.errorMessage}
            </Text>
          ) : null}
        </View>
        <Switch
          value={state.isEnabled}
          onValueChange={handleValueChange}
          disabled={mutationView.isSwitchDisabled}
          accessibilityLabel={title}
          testID="host-page-browser-tools-switch"
        />
      </View>
    </View>
  );
}
