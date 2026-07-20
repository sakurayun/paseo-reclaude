/**
 * Native fallback for component-owned web interaction styles.
 *
 * Web builds resolve the `.web.ts` implementation before this file. Keeping
 * the no-op fallback here lets cross-platform components install their web
 * stylesheet without a runtime platform branch.
 */
export function installWebInteractionStyles(_styleId: string, _cssText: string): () => void {
  return () => {};
}
