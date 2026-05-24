# Model Gateway Plan

## Status

- Branch: `feature/model-gateways`
- Base: `main` synced with `origin/main` and `upstream/main` at `7fbbb44a`
- Scope: generic gateway schema plus Codex runtime support. UI registry/editor remains the next product slice.

## Decision

Add a generic **Model Gateway** layer to Paseo. Do not add 9Router as a Paseo provider.

In upstream Paseo, a provider is an agent runtime:

```text
Provider = Codex / OpenCode / Claude / Gemini
```

A model gateway is different:

```text
Model Gateway = where the provider sends model traffic
```

9Router is a model gateway, not an agent runtime. It provides OpenAI/Claude/Gemini-compatible endpoints, model aliases, combos, account fallback, quota routing, and upstream provider management. It does not provide Paseo's agent lifecycle: workspace session, file edits, terminal/tool execution, permission handling, MCP, or persisted agent state.

Therefore the correct architecture is:

```text
Paseo agent runtime provider
  -> Codex / OpenCode / Claude / Gemini

Model gateway
  -> Native/default
  -> 9Router local
  -> 9Router remote
  -> Custom OpenAI-compatible endpoint
```

9Router becomes the first important preset for this layer, but the layer must stay generic.

## Research Findings

9Router's documented client-facing configuration is:

```text
Endpoint/Base URL: http://localhost:20128/v1
API Key: dashboard-generated key
Model: model id, alias, or combo name
```

Examples:

```text
kr/claude-sonnet-4.5
cx/gpt-5.5
my-coding-stack
premium-coding
```

The model field is intentionally not just a single upstream model. In 9Router it can be:

- direct model id
- model alias
- combo name

Paseo must treat it as an opaque model id/string and let the gateway resolve it.

9Router owns:

- upstream provider accounts
- model aliases
- combos
- fallback order
- quota routing
- request translation
- token refresh
- usage tracking
- internal dashboard/database state

Paseo owns:

- agent runtime selection
- workspace/session lifecycle
- provider launch config
- gateway endpoint/key/model selection
- secret redaction
- diagnostics

## Product Model

### Settings

Add a dedicated settings area:

```text
Settings
  Providers
  Model Gateways
```

`Providers` remains the agent runtime list:

```text
Codex
OpenCode
Claude
Gemini
```

`Model Gateways` contains model endpoint configurations:

```text
Native/default
9Router local
9Router remote
Custom OpenAI-compatible
```

### Gateway Fields

Each gateway stores:

```text
Name
Type
Base URL
API key
Models source
Manual model/combo entries
```

Initial gateway types:

```text
native
openai-compatible
```

9Router is represented as an `openai-compatible` preset:

```text
Name: 9Router local
Type: OpenAI-compatible
Base URL: http://localhost:20128/v1
API key: ****
Models: fetched from /models or manually entered
```

### New Agent / Custom Settings

The agent settings UI should keep provider and gateway separate:

```text
Provider
Codex

Model Gateway
Native

Model
gpt-5.5
```

When using 9Router:

```text
Provider
Codex

Model Gateway
9Router local

Model / Combo
my-coding-stack
```

Compact chat-bar display:

```text
Codex · gpt-5.5
```

With a gateway:

```text
Codex · 9Router local · my-coding-stack
```

## Behavioral Rules

1. Default behavior remains unchanged.
   - Existing users still get native provider behavior.
   - No gateway is required.

2. `Native` means the runtime provider uses its normal config/auth.

3. A gateway only changes model traffic routing.
   - It must not replace the runtime provider.
   - It must not own agent lifecycle.

4. Gateway model values are opaque.
   - Paseo should not parse 9Router prefixes like `kr/`, `cx/`, `cc/`.
   - Paseo should not expand or inspect combos.

5. Gateway secrets are redacted everywhere.

6. Existing custom provider support should continue to work.
   - The gateway layer is a first-class UI/data model for the same kind of endpoint routing.

## Runtime Application

When an agent launches:

```text
input:
  provider runtime
  selected model gateway
  selected model/combo id
  runtime options

resolve:
  if gateway = native:
    launch provider normally

  if gateway = openai-compatible:
    adapt endpoint/key/model into that runtime provider's config format
```

Runtime-specific config writers are still required, but they are implementation detail:

- Codex: managed `config.toml` and `auth.json`
- OpenCode: managed `opencode.json`
- Claude: managed settings/env

These are not 9Router-specific adapters. They are generic gateway-to-runtime config writers.

## Initial Implementation Scope

### Phase 1: Data Model

Add a gateway registry under Paseo config:

```ts
type ModelGateway =
  | {
      id: string;
      name: string;
      type: "native";
      createdAt: string;
      updatedAt: string;
    }
  | {
      id: string;
      name: string;
      type: "openai-compatible";
      baseUrl: string;
      apiKey?: string;
      modelSource: "manual" | "fetch";
      models?: Array<{ id: string; label?: string }>;
      createdAt: string;
      updatedAt: string;
    };
```

Do not call it `9router` in the core schema.

Preset helper:

```text
Add Gateway -> 9Router local
```

This simply pre-fills:

```text
type = openai-compatible
baseUrl = http://localhost:20128/v1
```

### Phase 2: Codex Runtime Support

Apply selected gateway to Codex launch config:

- set Codex model to selected gateway model/combo
- configure OpenAI-compatible provider endpoint through Codex `model_provider`
- pass API key through a redacted environment variable
- do not mutate user `~/.codex`

This must work with any OpenAI-compatible gateway, not just 9Router.

### Phase 3: Gateway UI + Diagnostics

For OpenAI-compatible gateways:

- normalize base URL
- check `/models`
- check bearer API key when provided
- show clear statuses:
  - reachable
  - unauthorized
  - no models returned
  - unreachable

Do not read 9Router logs or database.

### Phase 4: Other Runtime Support

Add gateway config writers for other providers only when needed:

- OpenCode
- Claude
- Gemini, if compatible and useful

Each runtime should remain responsible for its own agent behavior. Gateway only controls model endpoint routing.

## Manual Test Plan

### Native Regression

1. Create a new Codex agent with `Model Gateway = Native`.
2. Send a message.
3. Confirm behavior is unchanged.

### 9Router Local Gateway

1. Start 9Router locally.
2. Add gateway:

```text
Name: 9Router local
Type: OpenAI-compatible
Base URL: http://localhost:20128/v1
API key: from 9Router dashboard
```

3. Test connection.
4. Start a Codex agent.
5. Select gateway `9Router local`.
6. Enter/select model or combo:

```text
my-coding-stack
```

7. Send a message.
8. Confirm 9Router receives the request.
9. Confirm Paseo agent lifecycle still behaves like Codex.

### Custom Gateway

1. Add a generic OpenAI-compatible gateway.
2. Use manual model id.
3. Confirm launch config is generated without 9Router-specific assumptions.

## Risks

- Mixing provider/runtime and gateway language would confuse users.
- Treating 9Router as a provider would create a fake provider with incomplete agent lifecycle.
- Parsing 9Router combo/model prefixes in Paseo would duplicate 9Router behavior and create debt.
- Gateway config writers must not leak API keys.
- Existing native provider behavior must remain unchanged by default.

## Non-Goals

- Do not manage 9Router providers/accounts/combos inside Paseo.
- Do not import 9Router internal database state.
- Do not implement a generic chat-completions agent runtime.
- Do not make 9Router a built-in provider.
- Do not require profiles; upstream main does not have the dev-branch profile architecture.

## Final Direction

Implement a generic Model Gateway layer.

9Router is the first preset and primary validation target, but the implementation should be gateway-agnostic:

```text
Provider runtime: Codex
Model Gateway: 9Router local
Model / Combo: my-coding-stack
```

This keeps Paseo's provider architecture intact and adds router support without creating a provider-shaped abstraction for something that is not an agent runtime.
