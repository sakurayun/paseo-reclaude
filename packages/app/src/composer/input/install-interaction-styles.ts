/** Native fallback; web builds resolve install-interaction-styles.web.ts. */
export function installComposerInputInteractionStyles(): () => void {
  return () => {};
}
