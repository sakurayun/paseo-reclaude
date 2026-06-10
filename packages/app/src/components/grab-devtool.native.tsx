import type { ReactNode } from "react";
import { ReactNativeGrabRoot, ReactNativeGrabScreen } from "react-native-grab";

// react-native-grab ("grab an element, copy agent-ready context") is a
// dev-only tool: both components compile to passthroughs in production
// builds. It requires the Fabric renderer, so only the native platforms get
// the real implementation — web/Electron resolve the passthrough sibling
// (grab-devtool.tsx) via Metro platform extensions.

export function GrabRoot({ children }: { children: ReactNode }) {
  return <ReactNativeGrabRoot>{children}</ReactNativeGrabRoot>;
}

// Wraps every native-stack screen (via the navigator-level `screenLayout`)
// so grabbing reaches content inside screens, which render outside the root
// owner's native view hierarchy.
export function GrabScreen({ children }: { children: ReactNode }) {
  return <ReactNativeGrabScreen>{children}</ReactNativeGrabScreen>;
}
