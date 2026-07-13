import {
  AlmaLogo_PATH,
  AlpineLogo_PATH,
  AppleLogo_PATH,
  ArchLogo_PATH,
  CentosLogo_PATH,
  DebianLogo_PATH,
  FedoraLogo_PATH,
  FreeBsdLogo_PATH,
  GentooLogo_PATH,
  KaliLogo_PATH,
  LinuxMintLogo_PATH,
  ManjaroLogo_PATH,
  NixLogo_PATH,
  OpenSuseLogo_PATH,
  PopOsLogo_PATH,
  RedHatLogo_PATH,
  RockyLogo_PATH,
  TuxLogo_PATH,
  UbuntuLogo_PATH,
  VoidLogo_PATH,
} from "@/components/icons/os-logo-paths";

// Glyph data shared by built-in and remote Simple Icons resolution.
export interface OsIconGlyph {
  // Official Simple Icons SVG path data (viewBox 0 0 24 24).
  path: string;
  // Badge background — brand color, adjusted for white-glyph contrast when needed.
  color: string;
  label: string;
}

export interface OsIconDescriptor extends OsIconGlyph {
  // Whether this came from the offline catalog, CDN, or neutral fallback.
  source: "builtin" | "remote" | "fallback";
}

interface BuiltInBrand {
  path: string;
  color: string;
  label: string;
}

// Offline catalog keyed by /etc/os-release ID (and common aliases).
// Paths: Simple Icons official path data (CC0-1.0).
// Colors: brand hex, darkened/lightened when the brand would hide a white glyph.
const BUILTIN_OS: Record<string, BuiltInBrand> = {
  ubuntu: { path: UbuntuLogo_PATH, color: "#E95420", label: "Ubuntu" },
  debian: { path: DebianLogo_PATH, color: "#A81D33", label: "Debian" },
  fedora: { path: FedoraLogo_PATH, color: "#51A2DA", label: "Fedora" },
  centos: { path: CentosLogo_PATH, color: "#262577", label: "CentOS" },
  rhel: { path: RedHatLogo_PATH, color: "#EE0000", label: "Red Hat" },
  redhat: { path: RedHatLogo_PATH, color: "#EE0000", label: "Red Hat" },
  rocky: { path: RockyLogo_PATH, color: "#10B981", label: "Rocky Linux" },
  rockylinux: { path: RockyLogo_PATH, color: "#10B981", label: "Rocky Linux" },
  almalinux: { path: AlmaLogo_PATH, color: "#0F4266", label: "AlmaLinux" },
  alma: { path: AlmaLogo_PATH, color: "#0F4266", label: "AlmaLinux" },
  arch: { path: ArchLogo_PATH, color: "#1793D1", label: "Arch Linux" },
  archlinux: { path: ArchLogo_PATH, color: "#1793D1", label: "Arch Linux" },
  alpine: { path: AlpineLogo_PATH, color: "#0D597F", label: "Alpine" },
  alpinelinux: { path: AlpineLogo_PATH, color: "#0D597F", label: "Alpine" },
  suse: { path: OpenSuseLogo_PATH, color: "#73BA25", label: "openSUSE" },
  opensuse: { path: OpenSuseLogo_PATH, color: "#73BA25", label: "openSUSE" },
  "opensuse-leap": { path: OpenSuseLogo_PATH, color: "#73BA25", label: "openSUSE" },
  "opensuse-tumbleweed": { path: OpenSuseLogo_PATH, color: "#73BA25", label: "openSUSE" },
  nixos: { path: NixLogo_PATH, color: "#5277C3", label: "NixOS" },
  darwin: { path: AppleLogo_PATH, color: "#555555", label: "macOS" },
  macos: { path: AppleLogo_PATH, color: "#555555", label: "macOS" },
  osx: { path: AppleLogo_PATH, color: "#555555", label: "macOS" },
  linux: { path: TuxLogo_PATH, color: "#333333", label: "Linux" },
  // Extra common distros kept offline so SSH badges work without network.
  pop: { path: PopOsLogo_PATH, color: "#48B9C7", label: "Pop!_OS" },
  pop_os: { path: PopOsLogo_PATH, color: "#48B9C7", label: "Pop!_OS" },
  "pop-os": { path: PopOsLogo_PATH, color: "#48B9C7", label: "Pop!_OS" },
  popos: { path: PopOsLogo_PATH, color: "#48B9C7", label: "Pop!_OS" },
  manjaro: { path: ManjaroLogo_PATH, color: "#35BFA4", label: "Manjaro" },
  linuxmint: { path: LinuxMintLogo_PATH, color: "#86BE43", label: "Linux Mint" },
  mint: { path: LinuxMintLogo_PATH, color: "#86BE43", label: "Linux Mint" },
  kali: { path: KaliLogo_PATH, color: "#557C94", label: "Kali Linux" },
  kalilinux: { path: KaliLogo_PATH, color: "#557C94", label: "Kali Linux" },
  freebsd: { path: FreeBsdLogo_PATH, color: "#AB2B28", label: "FreeBSD" },
  gentoo: { path: GentooLogo_PATH, color: "#54487A", label: "Gentoo" },
  void: { path: VoidLogo_PATH, color: "#478061", label: "Void Linux" },
  voidlinux: { path: VoidLogo_PATH, color: "#478061", label: "Void Linux" },
};

// Map os-release / platform IDs that are not built-in to Simple Icons CDN slugs.
// Built-in keys never reach the CDN. Unknown IDs fall through as the normalized id.
const SIMPLE_ICONS_SLUG_ALIASES: Record<string, string> = {
  arch: "archlinux",
  alpine: "alpinelinux",
  rhel: "redhat",
  redhat: "redhat",
  rocky: "rockylinux",
  rockylinux: "rockylinux",
  alma: "almalinux",
  almalinux: "almalinux",
  suse: "opensuse",
  opensuse: "opensuse",
  "opensuse-leap": "opensuse",
  "opensuse-tumbleweed": "opensuse",
  darwin: "apple",
  macos: "apple",
  osx: "apple",
  pop: "popos",
  pop_os: "popos",
  "pop-os": "popos",
  popos: "popos",
  kali: "kalilinux",
  kalilinux: "kalilinux",
  mint: "linuxmint",
  linuxmint: "linuxmint",
  void: "voidlinux",
  voidlinux: "voidlinux",
  endeavour: "endeavouros",
  endeavouros: "endeavouros",
  elementary: "elementary",
  elementaryos: "elementary",
  zorin: "zorin",
  zorinos: "zorin",
  artix: "artixlinux",
  artixlinux: "artixlinux",
  garuda: "garudalinux",
  garudalinux: "garudalinux",
  solus: "solus",
  clearlinux: "clearlinux",
  clear: "clearlinux",
  pureos: "pureos",
  tailos: "tails",
  tails: "tails",
  qubes: "qubesos",
  qubesos: "qubesos",
  openbsd: "openbsd",
  netbsd: "netbsd",
  dragonfly: "dragonflybsd",
  dragonflybsd: "dragonflybsd",
  windows: "windows",
  win32: "windows",
  win64: "windows",
};

export const OS_ICON_FALLBACK: OsIconDescriptor = {
  path: "",
  color: "#6B7280",
  label: "Host",
  source: "fallback",
};

export function normalizeOsId(os: string): string {
  return os.toLowerCase().trim().replace(/\s+/g, "");
}

// Resolves offline first. Returns null when the slug should try the CDN.
export function getBuiltInOsIcon(os: string | null | undefined): OsIconDescriptor | null {
  if (!os) {
    return null;
  }
  const brand = BUILTIN_OS[normalizeOsId(os)];
  if (!brand) {
    return null;
  }
  return { path: brand.path, color: brand.color, label: brand.label, source: "builtin" };
}

// Simple Icons CDN slug for an os-release ID (only used when not built-in).
export function toSimpleIconsSlug(os: string): string {
  const key = normalizeOsId(os);
  if (SIMPLE_ICONS_SLUG_ALIASES[key]) {
    return SIMPLE_ICONS_SLUG_ALIASES[key];
  }
  // Strip common separators; Simple Icons slugs are alphanumeric lowercase.
  return key.replace(/[_.]/g, "");
}

// Sync lookup used by non-React call sites. Built-in only — remote needs useOsIcon.
export function getOsIcon(os: string | null | undefined): OsIconDescriptor {
  return getBuiltInOsIcon(os) ?? OS_ICON_FALLBACK;
}

// Whether a white glyph stays readable on this brand background.
export function adjustBrandColorForBadge(hex: string): string {
  const parsed = parseHexColor(hex);
  if (!parsed) {
    return "#6B7280";
  }
  const { r, g, b } = parsed;
  // Relative luminance (sRGB).
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  // Near-black brands (Apple, AlmaLinux official) → mid gray so white path reads.
  if (luminance < 0.12) {
    return "#555555";
  }
  // Very light brands (e.g. yellow Linux) → darken so white path has contrast.
  if (luminance > 0.72) {
    return darkenHex(parsed, 0.45);
  }
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

function parseHexColor(hex: string): { r: number; g: number; b: number } | null {
  const raw = hex.trim().replace(/^#/, "");
  if (raw.length === 3) {
    const r = Number.parseInt(raw[0] + raw[0], 16);
    const g = Number.parseInt(raw[1] + raw[1], 16);
    const b = Number.parseInt(raw[2] + raw[2], 16);
    if ([r, g, b].some((n) => Number.isNaN(n))) {
      return null;
    }
    return { r, g, b };
  }
  if (raw.length === 6 || raw.length === 8) {
    const r = Number.parseInt(raw.slice(0, 2), 16);
    const g = Number.parseInt(raw.slice(2, 4), 16);
    const b = Number.parseInt(raw.slice(4, 6), 16);
    if ([r, g, b].some((n) => Number.isNaN(n))) {
      return null;
    }
    return { r, g, b };
  }
  return null;
}

function darkenHex(rgb: { r: number; g: number; b: number }, amount: number): string {
  const factor = Math.max(0, Math.min(1, 1 - amount));
  const r = Math.round(rgb.r * factor);
  const g = Math.round(rgb.g * factor);
  const b = Math.round(rgb.b * factor);
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}
