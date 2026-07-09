import { Server, type LucideIcon } from "lucide-react-native";
import type { ComponentType } from "react";
import {
  AlpineLogo,
  AppleLogo,
  ArchLogo,
  DebianLogo,
  FedoraLogo,
  NixLogo,
  TuxLogo,
  UbuntuLogo,
  type OsLogoProps,
} from "@/components/icons/os-logos";

export interface OsIconDescriptor {
  // Brand SVG logo (drawn white over the brand-colored badge). Falls back to a
  // lucide Server glyph for unrecognized platforms.
  Logo: ComponentType<OsLogoProps> | null;
  FallbackIcon: LucideIcon;
  // Badge background color.
  color: string;
  label: string;
}

interface OsBrand {
  Logo: ComponentType<OsLogoProps> | null;
  color: string;
  label: string;
}

// Keyed by /etc/os-release ID (see SshHostPlatform.os).
const OS_BRAND: Record<string, OsBrand> = {
  ubuntu: { Logo: UbuntuLogo, color: "#E95420", label: "Ubuntu" },
  debian: { Logo: DebianLogo, color: "#A81D33", label: "Debian" },
  fedora: { Logo: FedoraLogo, color: "#51A2DA", label: "Fedora" },
  centos: { Logo: FedoraLogo, color: "#932279", label: "CentOS" },
  rhel: { Logo: FedoraLogo, color: "#EE0000", label: "Red Hat" },
  redhat: { Logo: FedoraLogo, color: "#EE0000", label: "Red Hat" },
  rocky: { Logo: TuxLogo, color: "#10B981", label: "Rocky Linux" },
  almalinux: { Logo: TuxLogo, color: "#0F4266", label: "AlmaLinux" },
  arch: { Logo: ArchLogo, color: "#1793D1", label: "Arch Linux" },
  alpine: { Logo: AlpineLogo, color: "#0D597F", label: "Alpine" },
  suse: { Logo: TuxLogo, color: "#30BA78", label: "openSUSE" },
  opensuse: { Logo: TuxLogo, color: "#30BA78", label: "openSUSE" },
  "opensuse-leap": { Logo: TuxLogo, color: "#30BA78", label: "openSUSE" },
  nixos: { Logo: NixLogo, color: "#5277C3", label: "NixOS" },
  darwin: { Logo: AppleLogo, color: "#555555", label: "macOS" },
  linux: { Logo: TuxLogo, color: "#333333", label: "Linux" },
};

const FALLBACK: OsIconDescriptor = {
  Logo: null,
  FallbackIcon: Server,
  color: "#6B7280",
  label: "Host",
};

// Resolves a platform slug (raw os-release ID) to a badge descriptor. Tolerates
// unknown values by returning a neutral server badge.
export function getOsIcon(os: string | null | undefined): OsIconDescriptor {
  if (!os) {
    return FALLBACK;
  }
  const brand = OS_BRAND[os.toLowerCase()];
  if (!brand) {
    return FALLBACK;
  }
  return { Logo: brand.Logo, FallbackIcon: Server, color: brand.color, label: brand.label };
}
