// Maps cryptic ssh2 / network failures into actionable messages for the connect UI.

export type SshConnectErrorKind =
  | "handshake"
  | "auth"
  | "timeout"
  | "refused"
  | "unreachable"
  | "host_not_found"
  | "unknown";

export interface ClassifiedSshConnectError {
  kind: SshConnectErrorKind;
  // Short title suitable for the error outcome field.
  message: string;
  // Extra guidance lines streamed as progress (English; client can still localize
  // known patterns on display).
  hints: string[];
}

const HANDSHAKE_PATTERNS = [
  /connection lost before handshake/i,
  /handshake/i,
  /kex_exchange_identification/i,
  /connection closed by remote host/i,
  /protocol.*banner/i,
  /all configured authentication methods failed/i,
];

export function classifySshConnectError(error: unknown): ClassifiedSshConnectError {
  const raw = error instanceof Error ? error.message : String(error);
  const level =
    error && typeof error === "object" && "level" in error
      ? String((error as { level?: string }).level ?? "")
      : "";

  if (level === "client-authentication" || /authentication methods failed/i.test(raw)) {
    return {
      kind: "auth",
      message: raw,
      hints: [],
    };
  }

  if (/ETIMEDOUT|timed out|timeout/i.test(raw)) {
    return {
      kind: "timeout",
      message: raw,
      hints: ["Check host/port, security group / firewall rules, and that sshd is listening."],
    };
  }

  if (/ECONNREFUSED|connection refused/i.test(raw)) {
    return {
      kind: "refused",
      message: raw,
      hints: ["Nothing accepted the TCP connection — is sshd running on that port?"],
    };
  }

  if (/ENOTFOUND|getaddrinfo|host not found/i.test(raw)) {
    return {
      kind: "host_not_found",
      message: raw,
      hints: ["DNS failed to resolve this hostname."],
    };
  }

  if (/EHOSTUNREACH|ENETUNREACH|network is unreachable/i.test(raw)) {
    return {
      kind: "unreachable",
      message: raw,
      hints: ["No route to host. Check VPN/routing and that the server is online."],
    };
  }

  if (HANDSHAKE_PATTERNS.some((pattern) => pattern.test(raw))) {
    return {
      kind: "handshake",
      message: raw,
      hints: [
        "TCP connected but the remote closed the connection before the SSH protocol started (no server banner).",
        "Common causes on this machine:",
        "  • Local VPN/proxy TUN mode (Clash / Surge / Mihomo) intercepting the route — look for gateway 198.18.x.x or a utun interface.",
        "  • Add a DIRECT rule for this host IP (or disable TUN for SSH) and retry.",
        "  • Server-side deny (fail2ban, MaxStartups, AllowUsers, or sshd only listening on another interface).",
        "  • Port 22 is open but not OpenSSH (load balancer / health-check that accepts then drops).",
        "Tip: try `ssh -vvv user@host` in Terminal; if that also fails with kex_exchange_identification, fix network/sshd first — it is not a Paseo-only issue.",
      ],
    };
  }

  return { kind: "unknown", message: raw, hints: [] };
}

/** True when falling back to the system `ssh` binary might still succeed. */
export function shouldTrySystemSshFallback(kind: SshConnectErrorKind): boolean {
  return kind === "handshake" || kind === "unknown";
}
