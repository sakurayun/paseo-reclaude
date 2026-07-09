import type {
  SshHostGroup,
  SshHostInfo,
  SshHostPatch,
  SshHostProxy,
  SshHostUpsert,
  SshKeyInfo,
} from "@getpaseo/protocol/messages";

// Pure, React-free form model for the SSH host editor (docs/forms.md pattern:
// closure + listeners + useSyncExternalStore adapter). All derived state
// (disclosure, canSubmit) is recomputed in `publish`.

export type ProxyType = "http" | "socks4" | "socks5";

export interface SshHostFormEnvEntry {
  // Stable id for list keys (env keys are user-editable and may collide).
  id: string;
  key: string;
  value: string;
}

export interface SshHostFormDisclosure {
  // FIDO2 and password are mutually exclusive paths — FIDO2 routes through the
  // system ssh binary, so the password field is hidden when it's on.
  showPasswordField: boolean;
  // Proxy detail fields only matter once a proxy type is chosen.
  showProxyFields: boolean;
  // Notices surfaced when a field forces the system-ssh fallback.
  showFido2Notice: boolean;
  showMoshNotice: boolean;
}

export interface SshHostFormState {
  mode: "create" | "edit";
  label: string;
  address: string;
  port: string;
  groupId: string | null;
  tags: string[];
  username: string;
  password: string;
  passwordDirty: boolean;
  keyId: string | null;
  useAgent: boolean;
  useFido2: boolean;
  agentForwarding: boolean;
  backspaceMode: "del" | "ctrl-h";
  startupSnippet: string;
  chainHostIds: string[];
  proxyType: ProxyType | null;
  proxyHost: string;
  proxyPort: string;
  proxyUsername: string;
  proxyPassword: string;
  proxyPasswordDirty: boolean;
  env: SshHostFormEnvEntry[];
  charset: string;
  moshEnabled: boolean;
  terminalThemeId: string | null;
  groups: SshHostGroup[];
  keys: SshKeyInfo[];
  chainCandidates: { id: string; label: string }[];
  disclosure: SshHostFormDisclosure;
  canSubmit: boolean;
  submitError: string | null;
}

export interface SshHostFormSnapshot {
  mode: "create" | "edit";
  host?: SshHostInfo;
  groups: readonly SshHostGroup[];
  keys: readonly SshKeyInfo[];
  // Other hosts, offered as host-chaining (ProxyJump) hops.
  chainCandidates: readonly { id: string; label: string }[];
}

export interface SshHostSubmitPayload {
  host: SshHostUpsert | SshHostPatch;
  // undefined = leave unchanged, null = clear, string = set.
  password?: string | null;
  proxyPassword?: string | null;
}

export interface SshHostFormModel {
  getState: () => SshHostFormState;
  subscribe: (listener: () => void) => () => void;
  close: () => void;
  applyOptions: (input: {
    groups: readonly SshHostGroup[];
    keys: readonly SshKeyInfo[];
    chainCandidates: readonly { id: string; label: string }[];
  }) => void;
  setLabel: (value: string) => void;
  setAddress: (value: string) => void;
  setPort: (value: string) => void;
  setGroup: (groupId: string | null) => void;
  addTag: (value: string) => void;
  removeTag: (value: string) => void;
  setUsername: (value: string) => void;
  setPassword: (value: string) => void;
  setKey: (keyId: string | null) => void;
  setUseAgent: (value: boolean) => void;
  setUseFido2: (value: boolean) => void;
  setAgentForwarding: (value: boolean) => void;
  setBackspaceMode: (value: "del" | "ctrl-h") => void;
  setStartupSnippet: (value: string) => void;
  setChain: (chainHostIds: string[]) => void;
  setProxyType: (value: ProxyType | null) => void;
  setProxyHost: (value: string) => void;
  setProxyPort: (value: string) => void;
  setProxyUsername: (value: string) => void;
  setProxyPassword: (value: string) => void;
  setEnvVar: (index: number, entry: SshHostFormEnvEntry) => void;
  addEnvVar: () => void;
  removeEnvVar: (index: number) => void;
  setCharset: (value: string) => void;
  setMoshEnabled: (value: boolean) => void;
  setTerminalThemeId: (value: string | null) => void;
  setSubmitError: (value: string | null) => void;
  buildSubmitPayload: () => SshHostSubmitPayload;
}

const DEFAULT_PORT = "22";
const DEFAULT_CHARSET = "utf-8";

// Monotonic env-entry id factory (Date.now/Math.random are unavailable in the
// pure model — a counter is deterministic and collision-free per model).
function createEnvIdFactory(): () => string {
  let counter = 0;
  return () => {
    counter += 1;
    return `env-${counter}`;
  };
}

type HostRecord = NonNullable<SshHostFormSnapshot["host"]>;

function buildIdentityFields(host: HostRecord | undefined) {
  return {
    label: host?.label ?? "",
    address: host?.address ?? "",
    port: host?.port != null ? String(host.port) : DEFAULT_PORT,
    groupId: host?.groupId ?? null,
    tags: host?.tags ? [...host.tags] : [],
  };
}

function buildCredentialFields(host: HostRecord | undefined) {
  return {
    username: host?.username ?? "",
    password: "",
    passwordDirty: false,
    keyId: host?.keyId ?? null,
    useAgent: host?.useAgent ?? false,
    useFido2: host?.useFido2 ?? false,
    agentForwarding: host?.agentForwarding ?? false,
  };
}

function buildConnectionFields(host: HostRecord | undefined) {
  const proxy = host?.proxy ?? null;
  return {
    chainHostIds: host?.chainHostIds ? [...host.chainHostIds] : [],
    proxyType: proxy?.proxyType ?? null,
    proxyHost: proxy?.host ?? "",
    proxyPort: proxy?.port != null ? String(proxy.port) : "",
    proxyUsername: proxy?.username ?? "",
    proxyPassword: "",
    proxyPasswordDirty: false,
  };
}

function buildTerminalFields(host: HostRecord | undefined, nextEnvId: () => string) {
  return {
    backspaceMode: host?.backspaceMode ?? ("del" as const),
    startupSnippet: host?.startupSnippet ?? "",
    env: host?.env
      ? Object.entries(host.env).map(([key, value]) => ({ id: nextEnvId(), key, value }))
      : [],
    charset: host?.charset ?? DEFAULT_CHARSET,
    moshEnabled: host?.mosh?.enabled ?? false,
    terminalThemeId: host?.terminalThemeId ?? null,
  };
}

function buildInitialState(
  snapshot: SshHostFormSnapshot,
  nextEnvId: () => string,
): SshHostFormState {
  const host = snapshot.host;
  return {
    mode: snapshot.mode,
    ...buildIdentityFields(host),
    ...buildCredentialFields(host),
    ...buildConnectionFields(host),
    ...buildTerminalFields(host, nextEnvId),
    groups: [...snapshot.groups],
    keys: [...snapshot.keys],
    chainCandidates: [...snapshot.chainCandidates],
    disclosure: {
      showPasswordField: true,
      showProxyFields: false,
      showFido2Notice: false,
      showMoshNotice: false,
    },
    canSubmit: false,
    submitError: null,
  };
}

function computeDisclosure(state: SshHostFormState): SshHostFormDisclosure {
  return {
    showPasswordField: !state.useFido2,
    showProxyFields: state.proxyType !== null,
    showFido2Notice: state.useFido2,
    showMoshNotice: state.moshEnabled,
  };
}

function isPortValid(value: string): boolean {
  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

function computeCanSubmit(state: SshHostFormState): boolean {
  if (state.address.trim().length === 0) {
    return false;
  }
  if (!isPortValid(state.port)) {
    return false;
  }
  if (state.proxyType !== null && state.proxyHost.trim().length === 0) {
    return false;
  }
  return true;
}

export function openSshHostForm(snapshot: SshHostFormSnapshot): SshHostFormModel {
  const listeners = new Set<() => void>();
  const nextEnvId = createEnvIdFactory();
  let closed = false;
  let state = buildInitialState(snapshot, nextEnvId);
  state = withDerived(state);

  function withDerived(next: SshHostFormState): SshHostFormState {
    const disclosure = computeDisclosure(next);
    const derived = { ...next, disclosure };
    return { ...derived, canSubmit: computeCanSubmit(derived) };
  }

  function publish(next: SshHostFormState): void {
    if (closed) {
      return;
    }
    state = withDerived(next);
    for (const listener of listeners) {
      listener();
    }
  }

  return {
    getState: () => state,
    subscribe(listener) {
      if (closed) {
        return () => {};
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    close() {
      closed = true;
      listeners.clear();
    },
    applyOptions(input) {
      publish({
        ...state,
        groups: [...input.groups],
        keys: [...input.keys],
        chainCandidates: [...input.chainCandidates],
      });
    },
    setLabel: (value) => publish({ ...state, label: value }),
    setAddress: (value) => publish({ ...state, address: value }),
    setPort: (value) => publish({ ...state, port: value }),
    setGroup: (groupId) => publish({ ...state, groupId }),
    addTag: (value) => {
      const tag = value.trim();
      if (tag.length === 0 || state.tags.includes(tag)) {
        return;
      }
      publish({ ...state, tags: [...state.tags, tag] });
    },
    removeTag: (value) => publish({ ...state, tags: state.tags.filter((tag) => tag !== value) }),
    setUsername: (value) => publish({ ...state, username: value }),
    setPassword: (value) => publish({ ...state, password: value, passwordDirty: true }),
    setKey: (keyId) => publish({ ...state, keyId }),
    setUseAgent: (value) => publish({ ...state, useAgent: value }),
    setUseFido2: (value) => publish({ ...state, useFido2: value }),
    setAgentForwarding: (value) => publish({ ...state, agentForwarding: value }),
    setBackspaceMode: (value) => publish({ ...state, backspaceMode: value }),
    setStartupSnippet: (value) => publish({ ...state, startupSnippet: value }),
    setChain: (chainHostIds) => publish({ ...state, chainHostIds }),
    setProxyType: (value) => publish({ ...state, proxyType: value }),
    setProxyHost: (value) => publish({ ...state, proxyHost: value }),
    setProxyPort: (value) => publish({ ...state, proxyPort: value }),
    setProxyUsername: (value) => publish({ ...state, proxyUsername: value }),
    setProxyPassword: (value) =>
      publish({ ...state, proxyPassword: value, proxyPasswordDirty: true }),
    setEnvVar: (index, entry) =>
      publish({
        ...state,
        env: state.env.map((existing, i) => (i === index ? entry : existing)),
      }),
    addEnvVar: () =>
      publish({ ...state, env: [...state.env, { id: nextEnvId(), key: "", value: "" }] }),
    removeEnvVar: (index) => publish({ ...state, env: state.env.filter((_, i) => i !== index) }),
    setCharset: (value) => publish({ ...state, charset: value }),
    setMoshEnabled: (value) => publish({ ...state, moshEnabled: value }),
    setTerminalThemeId: (value) => publish({ ...state, terminalThemeId: value }),
    setSubmitError: (value) => publish({ ...state, submitError: value }),
    buildSubmitPayload: () => buildSubmitPayload(state),
  };
}

function buildProxy(state: SshHostFormState): SshHostProxy | null {
  if (state.proxyType === null) {
    return null;
  }
  const proxy: SshHostProxy = {
    proxyType: state.proxyType,
    host: state.proxyHost.trim(),
    port: Number(state.proxyPort) || 0,
  };
  if (state.proxyUsername.trim().length > 0) {
    proxy.username = state.proxyUsername.trim();
  }
  proxy.hasPassword = state.proxyPassword.length > 0;
  return proxy;
}

function buildEnv(state: SshHostFormState): Record<string, string> {
  const env: Record<string, string> = {};
  for (const entry of state.env) {
    const key = entry.key.trim();
    if (key.length > 0) {
      env[key] = entry.value;
    }
  }
  return env;
}

export function buildSubmitPayload(state: SshHostFormState): SshHostSubmitPayload {
  const host: SshHostUpsert = {
    label: state.label.trim(),
    address: state.address.trim(),
    port: Number(state.port),
    groupId: state.groupId,
    tags: state.tags,
    username: state.username.trim(),
    keyId: state.keyId,
    useAgent: state.useAgent,
    useFido2: state.useFido2,
    backspaceMode: state.backspaceMode,
    agentForwarding: state.agentForwarding,
    startupSnippet: state.startupSnippet,
    chainHostIds: state.chainHostIds,
    proxy: buildProxy(state),
    env: buildEnv(state),
    charset: state.charset,
    mosh: { enabled: state.moshEnabled },
    terminalThemeId: state.terminalThemeId,
  };

  const payload: SshHostSubmitPayload = { host };
  // Password is only sent when the user touched the field: empty+dirty clears
  // it, non-empty sets it, untouched leaves the stored value alone.
  if (state.mode === "create") {
    if (state.password.length > 0) {
      payload.password = state.password;
    }
  } else if (state.passwordDirty) {
    payload.password = state.password.length > 0 ? state.password : null;
  }
  if (state.proxyType !== null && state.proxyPasswordDirty) {
    payload.proxyPassword = state.proxyPassword.length > 0 ? state.proxyPassword : null;
  }
  return payload;
}
