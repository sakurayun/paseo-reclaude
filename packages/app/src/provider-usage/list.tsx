import { Fragment } from "react";
import { View } from "react-native";
import { settingsStyles } from "@/styles/settings";
import { ProviderUsageCard } from "./card";
import { GrokSyncBar } from "./grok-sync-bar";
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
    <View style={settingsStyles.cardSurface}>
      {providers.map((usage) => (
        <Fragment key={usage.providerId}>
          <ProviderUsageCard usage={usage} />
          {usage.providerId === "claude" ? <ReclaudeAuthBar serverId={serverId} /> : null}
          {usage.providerId === "grok" ? <GrokSyncBar serverId={serverId} /> : null}
        </Fragment>
      ))}
    </View>
  );
}
