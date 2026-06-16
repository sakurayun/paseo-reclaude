import { useCallback, useEffect } from "react";
import type { ErrorBoundaryProps } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

// App-wide route safety net. A render-time exception anywhere in a screen subtree
// would otherwise unmount the React tree and leave a blank white screen — and,
// when it happens during startup restore of the last route, present as the app
// crashing on launch. expo-router renders this in place of the failed route,
// which keeps the navigator and the sidebar alive (so the user can switch to a
// working workspace/session), surfaces the actual error so it can be reported,
// and offers a retry. Intentionally uses plain react-native styles with no theme
// dependency so the fallback itself can never fail to render.
export function RouteErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  useEffect(() => {
    // Also surface in logs (logcat / daemon) for diagnosis.
    console.error("[RouteErrorBoundary] uncaught render error", error);
  }, [error]);

  const handleRetry = useCallback(() => {
    void retry();
  }, [retry]);

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>出错了</Text>
        <Text style={styles.subtitle}>
          页面渲染出现异常。可在侧边栏切换到其它工作区 / 会话，或点下方重试。
        </Text>
        <Text selectable style={styles.message}>
          {error.message || String(error)}
        </Text>
        {error.stack ? (
          <Text selectable style={styles.stack}>
            {error.stack}
          </Text>
        ) : null}
      </ScrollView>
      <Pressable style={styles.button} onPress={handleRetry} accessibilityRole="button">
        <Text style={styles.buttonText}>重试</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0b0b0c" },
  content: { padding: 20, paddingTop: 72, gap: 12 },
  title: { color: "#ffffff", fontSize: 22, fontWeight: "700" },
  subtitle: { color: "#9a9aa0", fontSize: 14, lineHeight: 20 },
  message: { color: "#ff7a7a", fontSize: 14, fontWeight: "600" },
  stack: { color: "#b8b8c0", fontSize: 11, lineHeight: 16, fontFamily: "monospace" },
  button: {
    margin: 16,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: "#2f6fed",
    alignItems: "center",
  },
  buttonText: { color: "#ffffff", fontSize: 16, fontWeight: "600" },
});
