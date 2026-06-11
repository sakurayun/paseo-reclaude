# Desktop ↔ desktop pairing

Two desktop (Electron) installs can control each other. Everything required already ships — multi-server client, relay enabled by default (`packages/server/src/server/persisted-config.ts`, `relay.enabled: true`), and pairing UI on both sides. No extra configuration is needed, and the machines do not need to share a network: traffic goes through the relay (`relay.paseo.sh:443`) with end-to-end encryption, so the relay never sees plaintext.

## Steps

On machine **B** (the one to be controlled):

1. Settings → host page → **Pair device** card (or the pair modal on the open-project screen).
2. Copy the pairing link (`https://app.paseo.sh/#offer=...`). The same payload is also shown as a QR code for mobile clients. CLI equivalent: `paseo daemon pair --json`.

On machine **A** (the controller):

1. Settings → **Add Host** → **Paste link**.
2. Paste B's link. The client decodes the `#offer=` payload (server ID, daemon public key, relay endpoint), probes the connection through the relay, and saves the host profile.
3. B now appears in the host picker; switching to it shows B's workspaces and agents with full control.

Repeat in the other direction to make the relationship mutual. Each daemon keeps its own identity (`server-id`, `daemon-keypair.json` in its `PASEO_HOME`), so the two hosts never collide.

## Gotchas

- The offer URL's `#offer=` fragment is a base64url JSON payload validated by `ConnectionOfferSchema` (`@getpaseo/protocol/connection-offer`). Anything after `#offer=` is taken verbatim — keep the link intact when sharing.
- The pair card shows "relay disabled" if the daemon config sets `daemon.relay.enabled: false`; re-enable it to pair across networks.
- When connecting programmatically with `DaemonClient`, `buildRelayWebSocketUrl` requires `role: "client"` and the client must pass a non-empty `clientId`; E2EE is mandatory on relay client connections (`e2ee: { enabled: true, daemonPublicKeyB64 }`).
- LAN direct connection (Add Host → Direct) is an alternative, but the target daemon must listen on a non-loopback address (`daemon.listen: "0.0.0.0:6767"`), since the default is `127.0.0.1`.
