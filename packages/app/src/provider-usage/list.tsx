import { Fragment } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { settingsStyles } from "@/styles/settings";
import { ProviderUsageCard } from "./card";
import { ReclaudeAuthBar } from "./reclaude-auth-bar";
import type { ProviderUsage } from "./types";

export function ProviderUsageList({
  providers,
  serverId,
}: {
  providers: ProviderUsage[];
  serverId: string;
}) {
  return (
    <View style={settingsStyles.card}>
      {providers.map((usage, index) => (
        <Fragment key={usage.providerId}>
          {index > 0 ? <View style={styles.divider} /> : null}
          <ProviderUsageCard usage={usage} />
          {usage.providerId === "claude" ? <ReclaudeAuthBar serverId={serverId} /> : null}
        </Fragment>
      ))}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  divider: {
    height: 1,
    backgroundColor: theme.colors.border,
  },
}));
