# T3 Code Custom

> Personal fork of [pingdotgg/t3code](https://github.com/pingdotgg/t3code) with customizations.
> Written in English because it is committed to a public repo.

## Repository

| Remote                  | URL                                          |
| ----------------------- | -------------------------------------------- |
| **origin** (our fork)   | `https://github.com/srmdn/t3code-custom.git` |
| **upstream** (official) | `https://github.com/pingdotgg/t3code.git`    |

## Golden Rules

- **NEVER push or open a PR against `upstream`.** Upstream is fetch/sync only.
- **NEVER install/update from official channels** (`npx t3@latest`, Homebrew, downloads from t3.codes, or the in-app auto-updater in Settings > About). Those channels ship pristine upstream and would silently overwrite our customizations.
- **Build from the fork only.** `srmdn/t3code-custom` is the single source of truth.
- **Never commit confidential data** (see [Confidentiality](#confidentiality)).

## Customizations

The fork is a small set of customizations on top of upstream: sound completion notifications and the DeepSeek provider are merged into `origin/main`, with focused fix branches in `fix/audio-*` and `fix/deepseek-provider-settings`.

### Merged into `origin/main` — audio & repo hygiene

| Commit     | Description                                                     | Files                                                             |
| ---------- | --------------------------------------------------------------- | ----------------------------------------------------------------- |
| `84019c79` | feat: sound notification when agent completes work              | `ChatView.tsx`, `useAgentCompletionSound.ts` (new)                |
| `f3420876` | chore: hard rule — never PR to upstream                         | `AGENTS.md`                                                       |
| `db23531d` | fix: `useAtomValue(null)` crashes React — empty atom instead    | `useAgentCompletionSound.ts`                                      |
| `c8160ec6` | feat: sound notification settings (toggle + volume)             | `SettingsPanels.tsx`, `useAgentCompletionSound.ts`, `settings.ts` |
| `b69533b2` | fix: volume slider missing CSS custom properties for fill color | `SettingsPanels.tsx`                                              |

### On `feat/deepseek-provider` (not yet pushed) — DeepSeek provider

| Commit     | Description                                              | Files                                                                                                                  |
| ---------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `69d5919d` | feat(contracts): add DeepSeek provider settings          | `packages/contracts/src/model.ts`, `packages/contracts/src/settings.ts`                                                |
| `ae991f4c` | feat(server): add DeepSeek provider status               | `apps/server/src/provider/Layers/DeepSeekProvider.ts`                                                                  |
| `6618fb35` | feat(server): add DeepSeek provider driver               | `apps/server/src/provider/Drivers/DeepSeekDriver.ts`                                                                   |
| `0cbe7ce4` | feat(server): add DeepSeek API adapter                   | `apps/server/src/provider/Layers/DeepSeekAdapter.ts`                                                                   |
| `1948bdfb` | feat(server): add DeepSeek text generation               | `apps/server/src/textGeneration/DeepSeekTextGeneration.ts`                                                             |
| `84d4f597` | feat(server): register DeepSeek built-in driver          | `apps/server/src/provider/builtInDrivers.ts`                                                                           |
| `a862779e` | feat(web): register DeepSeek provider UI                 | `apps/web/src/components/Icons.tsx`, `chat/providerIconUtils.ts`, `settings/providerDriverMeta.ts`, `session-logic.ts` |
| `45e11acc` | feat(mobile): register DeepSeek provider UI              | `apps/mobile/src/components/ProviderIcon.tsx`, `apps/mobile/src/lib/modelOptions.ts`                                   |
| `921fc117` | feat(server): add DeepSeek reasoning options             | `apps/server/src/provider/Layers/DeepSeekProvider.ts`                                                                  |
| `9f666d4d` | fix(server): preserve DeepSeek model selection           | `apps/server/src/provider/Layers/DeepSeekAdapter.ts`                                                                   |
| `6a4c6f8a` | test(server): verify DeepSeek model metadata             | `apps/server/src/provider/Layers/DeepSeekAdapter.test.ts`, `DeepSeekAdapter.ts`                                        |
| `77cf9267` | feat(server): run DeepSeek provider on the Codex harness | `DeepSeekDriver.ts`, `CodexAdapter.ts`, `CodexSessionRuntime.ts`, `settings.ts`, `DeepSeekProvider.test.ts`            |

## Feature: Sound completion notification (web)

Plays a sound when an agent turn completes, so you can leave T3 Code in the background.

- **Trigger:** fires when a thread's latest turn transitions to `completedAt` (a _just completed_ edge, not on every render).
- **Settings** (in Settings, "Sound notification"): enable toggle, volume slider (0–100, default `80`), and a preset picker with **5 presets** — `classic-ding-dong`, `codex`, `hero`, `ping`, `rich-double` — each with a **preview button** (plays without needing a completed turn).
- **Sound assets:** bundled as static files under `apps/web/public/sounds/`.
- **Contracts:** `soundEnabled`, `soundVolume`, `soundPreset` added to `packages/contracts/src/settings.ts` with a sensible default (`SoundPreset` default resolves to a built-in preset).
- **Browser autoplay:** playback failures are swallowed (`Audio.play()` can be blocked by autoplay policy) — never throws into the UI.
- **Files:** `apps/web/src/hooks/useAgentCompletionSound.ts`, `apps/web/src/components/ChatView.tsx`, `apps/web/src/components/settings/SettingsPanels.tsx`.

Scope: web-only, does not touch server, contracts beyond the settings schema, or other clients.

## Feature: DeepSeek provider on the Codex harness

DeepSeek is now a first-class, **fully agentic** provider tile in T3 Code — the tile keeps its DeepSeek identity (icon, "API" badge, interaction mode toggle, `deepseek-v4-pro`/`deepseek-v4-flash` models, reasoning option) while the execution engine behind it is the **Codex CLI harness** running against `~/.codex-deepseek`.

### Why the Codex harness, and not our own

This was a deliberate decision after researching DeepSeek's ecosystem:

- **DeepSeek ships no agentic CLI harness.** Official DeepSeek docs do not offer one; their documented agent integration path is _"point an existing mature harness at the DeepSeek API"_ (Codex, OpenCode, Claude Code, Cline, …).
- **OSS "deepseek harness" candidates exist but are immature** — small communities, young, and not battle-tested. Community consensus (and DeepSeek's own direction) is reuse-over-rewrite: a mature harness wins.
- **Codex CLI is the strongest fit:** open source, battle-tested, and ships the full agentic tool system (shell, file edits, web search, MCP). DeepSeek's API is **Codex-compatible** — a documented, first-party integration path.
- **Writing our own harness would mean reimplementing the tool loop, safety, checkpointing, MCP, and search** — a large, ongoing maintenance surface. T3 Code already provides the orchestration layer (events, receipts, checkpoints, turns) on top of any provider runtime; the harness itself is the part that does not belong in a control-surface app.
- **What changed:** before this work, DeepSeek in the fork was chat-only over a REST adapter (no tools). Reusing the Codex harness gives DeepSeek full agentic behavior behind the same tile — with zero UI loss.

### Architecture

- `DeepSeekDriver` now builds a **Codex adapter** (`makeCodexAdapter`) and **Codex text generation** (`makeCodexTextGeneration`) with `provider: "deepseek"`, pointed at a dedicated home: `~/.codex-deepseek` (fallback default when the setting is empty).
- The Codex adapter/session runtime were **parameterized**: `PROVIDER` is now a per-instance value (default `"codex"`, fully backward compatible — other providers and existing tests are unaffected). This is the smallest change that lets one harness binary serve multiple provider identities.
- `DeepSeekSettings` gained `binaryPath` (the Codex binary) and `homePath` (the DeepSeek-scoped Codex home) in `packages/contracts/src/settings.ts`.
- **Provider status** is probed through the Codex app-server (`checkCodexProviderStatus`): binary present + config home valid → tile shows ready/not-ready.
- **Reasoning options:** the tile exposes a single Reasoning option with id `reasoningEffort` (High/Max for Pro; Low/High/Max for Flash, default High). Rationale: the Codex app-server only forwards `reasoningEffort` to a turn — a boolean "Thinking" toggle would render but have no effect, so we did not ship it.
- **External configuration lives outside the repo:** `~/.codex-deepseek/config.toml` (model, provider, auth) and `~/.codex-deepseek/models.json`. Never commit anything from that directory — it contains credentials.
- **Settings form is honest:** the provider settings form only exposes `binaryPath` and `homePath`. The legacy `apiKey`, `baseUrl`, and `model` fields exist in the schema for backward compatibility but are hidden, because the running driver never reads them — the Codex harness reads auth and model from the home directory's `config.toml` (or `DEEPSEEK_API_KEY`).
- **Dead code removed:** the superseded chat-only REST adapter (`DeepSeekAdapter.ts`) and its standalone text generation module were removed; the Codex harness path is the only DeepSeek runtime.

### Known notes

- `deepseek-v4-flash` works end-to-end (verified: agentic tool calls, checkpoints, context-window reporting).
- `deepseek-v4-pro` is recognized by the harness, but the DeepSeek API still gates Codex integration with it as of early August 2026 (the promised early-August availability did not open; verified by testing). The fork therefore defaults to `deepseek-v4-flash`; `pro` stays selectable in the model list, and the gate error surfaces correctly in the UI. This is a server-side gate, not a bug in our code.

### Merge risk with upstream

Unlike the audio customizations (web-only), the DeepSeek work **touches shared server code** that upstream also evolves. Files most likely to conflict on sync:

- `apps/server/src/provider/Layers/CodexAdapter.ts`
- `apps/server/src/provider/Layers/CodexSessionRuntime.ts`
- `apps/server/src/provider/Layers/DeepSeekProvider.ts`
- `apps/server/src/provider/Drivers/DeepSeekDriver.ts`
- `packages/contracts/src/settings.ts`

Our changes are parameterization-only (defaults preserve upstream behavior), so conflicts are mechanical to resolve — but expect them.

## Scope (updated)

Customizations are no longer web-only. They now cover:

- `apps/web` (audio notification)
- `packages/contracts` (settings schema: sound + DeepSeek)
- `apps/server` (DeepSeek provider, driver, Codex harness parameterization)
- `apps/mobile` (DeepSeek provider registration)

## Additional Configuration

- **GitHub Actions:** Disabled (`enabled: false`) in this repo. Upstream workflows (CI, T3 Connect relay deploy, Mobile EAS Preview) are irrelevant to a personal fork and only stall.
- **`.gitignore`:** adds `.sisyphus/` (AI agent working directory).
- **Branch naming:** `feat/*`, `fix/*`, `chore/*`. Merge to `main`, delete the branch after merge.

## Syncing from Upstream

```
# 1. Fetch latest upstream changes
git fetch upstream

# 2. Merge upstream into main
git merge upstream/main

# 3. Resolve conflicts if any — expect them in the "merge risk" files above;
#    our changes are additive/parameterized, so keep both sides where possible
# 4. Push to origin
git push origin main
```

Frequency: every 1–2 weeks, or when a needed upstream feature/bugfix lands.

## Confidentiality

This repo is **public**. Before every commit/push, scan changed files for:

- Secrets: API keys, tokens, pairing URLs, `.env`, anything under `~/.codex-deepseek` (contains credentials).
- Data files: `*.db`, `*-wal`, `*-shm`, `usage_data_*` dashboard exports.
- Personal machine or VPS details (hostnames, IPs, specs, provider names, SSH config).
- Build output (`dist/`), logs, and test databases.

When in doubt, generalize. `CUSTOM.md` itself must stay free of credentials and machine-specific data.

## Philosophy

This is not "fork and forget" — it is **fork and merge**. Take features and bugfixes from upstream without losing customizations. The fork is intentionally built on parameterization and additive changes so that syncing stays mechanical even when upstream touches the same files.
