// Single source of truth for which locales and namespaces exist. Adding a namespace =
// add its catalog files under locales/<lng>/ and one line per locale here. Adding a
// language = add a block here. Everything else (init `ns`, typed keys, the catalog
// test) derives from this object.
import enAgents from "./locales/en/agents";
import enApp from "./locales/en/app";
import enCommon from "./locales/en/common";
import enComposer from "./locales/en/composer";
import enGit from "./locales/en/git";
import enSettings from "./locales/en/settings";
import enShortcuts from "./locales/en/shortcuts";
import enTerminal from "./locales/en/terminal";
import enTime from "./locales/en/time";
import enTimeline from "./locales/en/timeline";
import enVoice from "./locales/en/voice";
import enWorkspaces from "./locales/en/workspaces";
import esAgents from "./locales/es/agents";
import esApp from "./locales/es/app";
import esCommon from "./locales/es/common";
import esComposer from "./locales/es/composer";
import esGit from "./locales/es/git";
import esSettings from "./locales/es/settings";
import esShortcuts from "./locales/es/shortcuts";
import esTerminal from "./locales/es/terminal";
import esTime from "./locales/es/time";
import esTimeline from "./locales/es/timeline";
import esVoice from "./locales/es/voice";
import esWorkspaces from "./locales/es/workspaces";
import jaAgents from "./locales/ja/agents";
import jaApp from "./locales/ja/app";
import jaCommon from "./locales/ja/common";
import jaComposer from "./locales/ja/composer";
import jaGit from "./locales/ja/git";
import jaSettings from "./locales/ja/settings";
import jaShortcuts from "./locales/ja/shortcuts";
import jaTerminal from "./locales/ja/terminal";
import jaTime from "./locales/ja/time";
import jaTimeline from "./locales/ja/timeline";
import jaVoice from "./locales/ja/voice";
import jaWorkspaces from "./locales/ja/workspaces";
import zhAgents from "./locales/zh/agents";
import zhApp from "./locales/zh/app";
import zhCommon from "./locales/zh/common";
import zhComposer from "./locales/zh/composer";
import zhGit from "./locales/zh/git";
import zhSettings from "./locales/zh/settings";
import zhShortcuts from "./locales/zh/shortcuts";
import zhTerminal from "./locales/zh/terminal";
import zhTime from "./locales/zh/time";
import zhTimeline from "./locales/zh/timeline";
import zhVoice from "./locales/zh/voice";
import zhWorkspaces from "./locales/zh/workspaces";

export const defaultNS = "common";

export const resources = {
  en: {
    agents: enAgents,
    app: enApp,
    common: enCommon,
    composer: enComposer,
    git: enGit,
    settings: enSettings,
    shortcuts: enShortcuts,
    terminal: enTerminal,
    time: enTime,
    timeline: enTimeline,
    voice: enVoice,
    workspaces: enWorkspaces,
  },
  zh: {
    agents: zhAgents,
    app: zhApp,
    common: zhCommon,
    composer: zhComposer,
    git: zhGit,
    settings: zhSettings,
    shortcuts: zhShortcuts,
    terminal: zhTerminal,
    time: zhTime,
    timeline: zhTimeline,
    voice: zhVoice,
    workspaces: zhWorkspaces,
  },
  ja: {
    agents: jaAgents,
    app: jaApp,
    common: jaCommon,
    composer: jaComposer,
    git: jaGit,
    settings: jaSettings,
    shortcuts: jaShortcuts,
    terminal: jaTerminal,
    time: jaTime,
    timeline: jaTimeline,
    voice: jaVoice,
    workspaces: jaWorkspaces,
  },
  es: {
    agents: esAgents,
    app: esApp,
    common: esCommon,
    composer: esComposer,
    git: esGit,
    settings: esSettings,
    shortcuts: esShortcuts,
    terminal: esTerminal,
    time: esTime,
    timeline: esTimeline,
    voice: esVoice,
    workspaces: esWorkspaces,
  },
} as const;

export type AppResources = (typeof resources)["en"];

export const NAMESPACES = Object.keys(resources.en) as Array<keyof AppResources>;
