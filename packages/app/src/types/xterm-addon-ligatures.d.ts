declare module "@xterm/addon-ligatures/lib/addon-ligatures.mjs" {
  import type { ITerminalAddon } from "@xterm/xterm";

  export interface ILigatureOptions {
    fallbackLigatures?: string[];
    fontFeatureSettings?: string;
  }

  export class LigaturesAddon implements ITerminalAddon {
    constructor(options?: Partial<ILigatureOptions>);
    activate(terminal: import("@xterm/xterm").Terminal): void;
    dispose(): void;
  }
}

declare module "@xterm/addon-ligatures" {
  export * from "@xterm/addon-ligatures/lib/addon-ligatures.mjs";
}
