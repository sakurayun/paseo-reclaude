/**
 * Tiny pub/sub for pushing text into a mounted composer from elsewhere in the
 * UI (e.g. the source control preset menu). Commands are addressed by the
 * composer's draft key; an unmatched command is a no-op.
 */
export interface ComposerInsertCommand {
  draftKey: string;
  text: string;
}

type ComposerInsertListener = (command: ComposerInsertCommand) => void;

const listeners = new Set<ComposerInsertListener>();

export function sendComposerInsert(command: ComposerInsertCommand): void {
  for (const listener of listeners) {
    listener(command);
  }
}

export function subscribeComposerInsert(listener: ComposerInsertListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
