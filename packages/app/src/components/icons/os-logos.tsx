import Svg, { Circle, Path } from "react-native-svg";

// Compact, recognizable distro marks rendered in a single foreground color
// (drawn white over a brand-colored badge). These are simplified glyphs, not
// pixel-exact brand logos — enough to tell platforms apart at a glance.

export interface OsLogoProps {
  size?: number;
  color?: string;
}

export function UbuntuLogo({ size = 16, color = "#fff" }: OsLogoProps) {
  // Circle of friends: a ring with three nodes.
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="12" r="7" stroke={color} strokeWidth="2" />
      <Circle cx="12" cy="4.5" r="2.2" fill={color} />
      <Circle cx="5.5" cy="16" r="2.2" fill={color} />
      <Circle cx="18.5" cy="16" r="2.2" fill={color} />
    </Svg>
  );
}

export function DebianLogo({ size = 16, color = "#fff" }: OsLogoProps) {
  // Simplified swirl: an open spiral.
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M15.5 6.5A6.5 6.5 0 1 0 18 12a5 5 0 1 0-8.5-3.5"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </Svg>
  );
}

export function FedoraLogo({ size = 16, color = "#fff" }: OsLogoProps) {
  // Infinity/f mark inside a circle.
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="12" r="8.5" stroke={color} strokeWidth="1.6" />
      <Path
        d="M14 8.5a2.2 2.2 0 0 0-3.7 1.6V16m-1.5-4h3.6"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function ArchLogo({ size = 16, color = "#fff" }: OsLogoProps) {
  // Mountain peak.
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M12 4 4 19h16L12 4Z" fill={color} opacity={0.9} />
    </Svg>
  );
}

export function AlpineLogo({ size = 16, color = "#fff" }: OsLogoProps) {
  // Twin mountain peaks.
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M7 17 10 12l2 3.2M13.5 9 20 17H4"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function NixLogo({ size = 16, color = "#fff" }: OsLogoProps) {
  // Six-armed snowflake (Nix lambda-flake motif, simplified).
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 4v16M5 8l14 8M19 8 5 16"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </Svg>
  );
}

export function AppleLogo({ size = 16, color = "#fff" }: OsLogoProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <Path d="M16.5 12.6c0-2 1.6-3 1.7-3-.9-1.4-2.4-1.6-2.9-1.6-1.2-.1-2.4.7-3 .7s-1.6-.7-2.6-.7c-1.3 0-2.6.8-3.3 2-1.4 2.4-.4 6 1 8 .7 1 1.4 2 2.4 2 1 0 1.3-.6 2.5-.6s1.5.6 2.5.6 1.7-.9 2.3-1.9c.7-1.1 1-2.2 1-2.3-.1 0-2-.8-2-2.9ZM14.6 6.2c.5-.7.9-1.6.8-2.5-.8 0-1.7.5-2.3 1.2-.5.6-1 1.5-.8 2.4.9.1 1.8-.4 2.3-1.1Z" />
    </Svg>
  );
}

export function TuxLogo({ size = 16, color = "#fff" }: OsLogoProps) {
  // Generic Linux: a penguin silhouette (simplified).
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <Path d="M12 3c-2.2 0-3.5 1.7-3.5 4v3.2c0 1-.6 1.8-1.3 2.7C6 14.4 5 15.7 5 17c0 1.6 1.4 2.4 3 2.8V20h8v-.2c1.6-.4 3-1.2 3-2.8 0-1.3-1-2.6-2.2-4.1-.7-.9-1.3-1.7-1.3-2.7V7c0-2.3-1.3-4-3.5-4Zm-1.4 4.2a.9.9 0 1 1 0 1.8.9.9 0 0 1 0-1.8Zm2.8 0a.9.9 0 1 1 0 1.8.9.9 0 0 1 0-1.8ZM12 9.6c.7 0 1.4.4 1.4.9s-.7 1-1.4 1-1.4-.5-1.4-1 .7-.9 1.4-.9Z" />
    </Svg>
  );
}
