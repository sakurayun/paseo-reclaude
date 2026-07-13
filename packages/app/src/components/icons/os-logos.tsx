import Svg, { Path } from "react-native-svg";
import {
  UbuntuLogo_PATH,
  DebianLogo_PATH,
  FedoraLogo_PATH,
  ArchLogo_PATH,
  AlpineLogo_PATH,
  NixLogo_PATH,
  AppleLogo_PATH,
  TuxLogo_PATH,
  OpenSuseLogo_PATH,
  RedHatLogo_PATH,
  CentosLogo_PATH,
  RockyLogo_PATH,
  AlmaLogo_PATH,
  PopOsLogo_PATH,
  ManjaroLogo_PATH,
  LinuxMintLogo_PATH,
  KaliLogo_PATH,
  FreeBsdLogo_PATH,
  GentooLogo_PATH,
  VoidLogo_PATH,
} from "@/components/icons/os-logo-paths";

// Re-export path data for consumers that only need the geometry.
export {
  UbuntuLogo_PATH,
  DebianLogo_PATH,
  FedoraLogo_PATH,
  ArchLogo_PATH,
  AlpineLogo_PATH,
  NixLogo_PATH,
  AppleLogo_PATH,
  TuxLogo_PATH,
  OpenSuseLogo_PATH,
  RedHatLogo_PATH,
  CentosLogo_PATH,
  RockyLogo_PATH,
  AlmaLogo_PATH,
  PopOsLogo_PATH,
  ManjaroLogo_PATH,
  LinuxMintLogo_PATH,
  KaliLogo_PATH,
  FreeBsdLogo_PATH,
  GentooLogo_PATH,
  VoidLogo_PATH,
} from "@/components/icons/os-logo-paths";

// Official brand marks from Simple Icons (https://simpleicons.org),
// rendered as monochrome glyphs on a brand-colored badge.
// Paths are the published Simple Icons SVG path data (not hand-drawn).
// Source: simple-icons@11.14.0 / cdn.simpleicons.org (CC0-1.0 for path data).

export interface OsLogoProps {
  size?: number;
  color?: string;
}

// Shared monochrome Simple Icons renderer — used by built-in logos and by
// on-demand remote glyphs (same 24×24 path data).
export function SimpleIconLogo({
  path,
  size = 16,
  color = "#fff",
}: OsLogoProps & { path: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <Path d={path} />
    </Svg>
  );
}

export function UbuntuLogo({ size = 16, color = "#fff" }: OsLogoProps) {
  return <SimpleIconLogo path={UbuntuLogo_PATH} size={size} color={color} />;
}

export function DebianLogo({ size = 16, color = "#fff" }: OsLogoProps) {
  return <SimpleIconLogo path={DebianLogo_PATH} size={size} color={color} />;
}

export function FedoraLogo({ size = 16, color = "#fff" }: OsLogoProps) {
  return <SimpleIconLogo path={FedoraLogo_PATH} size={size} color={color} />;
}

export function ArchLogo({ size = 16, color = "#fff" }: OsLogoProps) {
  return <SimpleIconLogo path={ArchLogo_PATH} size={size} color={color} />;
}

export function AlpineLogo({ size = 16, color = "#fff" }: OsLogoProps) {
  return <SimpleIconLogo path={AlpineLogo_PATH} size={size} color={color} />;
}

export function NixLogo({ size = 16, color = "#fff" }: OsLogoProps) {
  return <SimpleIconLogo path={NixLogo_PATH} size={size} color={color} />;
}

export function AppleLogo({ size = 16, color = "#fff" }: OsLogoProps) {
  return <SimpleIconLogo path={AppleLogo_PATH} size={size} color={color} />;
}

export function TuxLogo({ size = 16, color = "#fff" }: OsLogoProps) {
  return <SimpleIconLogo path={TuxLogo_PATH} size={size} color={color} />;
}

export function OpenSuseLogo({ size = 16, color = "#fff" }: OsLogoProps) {
  return <SimpleIconLogo path={OpenSuseLogo_PATH} size={size} color={color} />;
}

export function RedHatLogo({ size = 16, color = "#fff" }: OsLogoProps) {
  return <SimpleIconLogo path={RedHatLogo_PATH} size={size} color={color} />;
}

export function CentosLogo({ size = 16, color = "#fff" }: OsLogoProps) {
  return <SimpleIconLogo path={CentosLogo_PATH} size={size} color={color} />;
}

export function RockyLogo({ size = 16, color = "#fff" }: OsLogoProps) {
  return <SimpleIconLogo path={RockyLogo_PATH} size={size} color={color} />;
}

export function AlmaLogo({ size = 16, color = "#fff" }: OsLogoProps) {
  return <SimpleIconLogo path={AlmaLogo_PATH} size={size} color={color} />;
}

export function PopOsLogo({ size = 16, color = "#fff" }: OsLogoProps) {
  return <SimpleIconLogo path={PopOsLogo_PATH} size={size} color={color} />;
}

export function ManjaroLogo({ size = 16, color = "#fff" }: OsLogoProps) {
  return <SimpleIconLogo path={ManjaroLogo_PATH} size={size} color={color} />;
}

export function LinuxMintLogo({ size = 16, color = "#fff" }: OsLogoProps) {
  return <SimpleIconLogo path={LinuxMintLogo_PATH} size={size} color={color} />;
}

export function KaliLogo({ size = 16, color = "#fff" }: OsLogoProps) {
  return <SimpleIconLogo path={KaliLogo_PATH} size={size} color={color} />;
}

export function FreeBsdLogo({ size = 16, color = "#fff" }: OsLogoProps) {
  return <SimpleIconLogo path={FreeBsdLogo_PATH} size={size} color={color} />;
}

export function GentooLogo({ size = 16, color = "#fff" }: OsLogoProps) {
  return <SimpleIconLogo path={GentooLogo_PATH} size={size} color={color} />;
}

export function VoidLogo({ size = 16, color = "#fff" }: OsLogoProps) {
  return <SimpleIconLogo path={VoidLogo_PATH} size={size} color={color} />;
}
