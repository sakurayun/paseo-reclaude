import type { ReactNode } from "react";

// Web/Electron passthroughs: react-native-grab supports only the native
// Fabric renderer, so the real wrappers live in grab-devtool.native.tsx.

export function GrabRoot({ children }: { children: ReactNode }) {
  return children;
}

export function GrabScreen({ children }: { children: ReactNode }) {
  return children;
}
