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

The fork is a small set of customizations on top of upstream, all merged into `origin/main`: a complete Files panel (all-files listing plus create/rename/delete/move operations), desktop completion notifications (custom chime + OS banner with the agent's final output), sound completion notifications (consistent-loudness presets), and the DeepSeek provider on the Codex harness (honest settings form, defaulting to `deepseek-v4-flash`).

### Merged into `origin/main` — audio & repo hygiene

| Commit     | Description                                                     | Files                                                             |
| ---------- | --------------------------------------------------------------- | ----------------------------------------------------------------- |
| `84019c79` | feat: sound notification when agent completes work              | `ChatView.tsx`, `useAgentCompletionSound.ts` (new)                |
| `f3420876` | chore: hard rule — never PR to upstream                         | `AGENTS.md`                                                       |
| `db23531d` | fix: `useAtomValue(null)` crashes React — empty atom instead    | `useAgentCompletionSound.ts`                                      |
| `c8160ec6` | feat: sound notification settings (toggle + volume)             | `SettingsPanels.tsx`, `useAgentCompletionSound.ts`, `settings.ts` |
| `b69533b2` | fix: volume slider missing CSS custom properties for fill color | `SettingsPanels.tsx`                                              |

### Merged into `origin/main` — Files panel & desktop notifications

| Commit     | Description                                                  | Files                                                                                                                                      |
| ---------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `19fe7a0c` | feat(web): complete Files panel management and visibility    | `FileBrowserPanel.tsx`, `WorkspaceEntries.ts`, `WorkspaceFileSystem.ts`, `project.ts`, `ws.ts`, `projectCommands.ts`, mobile file browsers |
| `16084bc3` | feat(desktop): notify when an agent finishes a turn          | `notifications.ts` (new), `preload.ts`, `channels.ts`, `useAgentCompletionNotifications.ts` (new), `localApi.ts`, `settings.ts`            |
| `aa4d21e6` | fix(desktop): always show completion notifications           | `useAgentCompletionNotifications.ts`, `SettingsPanels.tsx`, `notifications.ts`                                                             |
| `c7e5ee5d` | fix(desktop): unify completion sound and notification        | `useAgentCompletionNotifications.ts`, `useAgentCompletionSound.ts`, `ChatView.tsx`, `notifications.ts`                                     |
| `c136c397` | fix(desktop): guarantee the completion banner shows          | `useAgentCompletionNotifications.ts`, `notifications.ts`                                                                                   |
| `2dc4d304` | fix(desktop): show the finished task in completion banners   | `useAgentCompletionNotifications.ts`                                                                                                       |
| `96c61352` | fix(desktop): carry the latest message text in thread shells | `orchestration.ts`, `ProjectionSnapshotQuery.ts`, `useAgentCompletionNotifications.ts`                                                     |

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

## Feature: Completion sound & OS notifications (web + desktop)

Plays the selected preset chime and shows an OS notification banner when an agent turn completes, so you can leave T3 Code in the background.

- **Trigger:** a single root-level hook (`useAgentCompletionNotifications`) watches every thread shell and fires when a thread's latest turn transitions to `completedAt` (a _just completed_ edge, not on every render). Sound and banner share that one transition, so they stay in sync, and background threads notify too.
- **Banner:** shows the thread's latest message — the agent's final output — served directly in the thread shell (`latestMessage`), so no client-side fetch is needed. Clicking the banner focuses the main window.
- **Sound:** the banner is silent at the OS level (`silent: true`), so the selected preset chime is the only sound and macOS's default notification sound never plays.
- **Edge cases:** the first observation of a thread only establishes a baseline, so opening an already-finished thread never chimes. Completion state is tracked per thread.
- **Settings** (in Settings → General): **Sound notifications** enable toggle, volume slider (0–100, default `80`), preset picker with **5 presets** — `classic-ding-dong`, `codex`, `hero`, `ping`, `rich-double` — each with a **preview button**; **System notifications** enable toggle plus a **Send test** button to verify macOS permission.
- **Sound assets:** bundled as static files under `apps/web/public/sounds/`, normalized to consistent loudness (peak ≈ -1 dBFS, integrated ≈ -12 LUFS, all 16-bit PCM) so every preset is clearly audible at the same slider setting.
- **Contracts:** `soundEnabled`, `soundVolume`, `soundPreset`, and `completionNotificationsEnabled` in `packages/contracts/src/settings.ts`; `latestMessage` added to `OrchestrationThreadShell` in `packages/contracts/src/orchestration.ts`.
- **Browser autoplay:** playback failures are swallowed (`Audio.play()` can be blocked by autoplay policy) — never throws into the UI.
- **Desktop IPC:** `desktop:show-notification` channel — `apps/desktop/src/ipc/methods/notifications.ts`, `apps/desktop/src/ipc/channels.ts`, `apps/desktop/src/ipc/DesktopIpcHandlers.ts`, `apps/desktop/src/preload.ts`.
- **Files:** `apps/web/src/hooks/useAgentCompletionNotifications.ts` (root-level trigger), `apps/web/src/hooks/useAgentCompletionSound.ts`, `apps/web/src/localApi.ts`, `apps/web/src/routes/__root.tsx`, `apps/web/src/components/settings/SettingsPanels.tsx`, `apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts`.

Scope: web + desktop. The sound hook no longer lives in `ChatView.tsx`; the root-level hook handles every thread, so the earlier "chimes when you come back to a thread" behavior is replaced by immediate per-thread chimes.

## Feature: Files panel (web + mobile)

The Files sidebar browses the real local workspace instead of the search index, so nothing is hidden from view.

- **All-files listing:** `projects.listEntries` accepts `includeIgnored`; the server walks the workspace directly and returns dotfiles and gitignored paths, with a partial indicator when the 25,000-entry cap is hit. Web and mobile file browsers both opt in.
- **File operations:** new typed RPCs `projects.createEntry`, `projects.renameEntry`, `projects.deleteEntry` with workspace-root path safety and index refresh. The UI supports creating files and folders at the project root (header **+** button) or inside folders, inline rename, delete with confirmation, and drag-and-drop moves.
- **Expand / collapse all:** a single header toggle expands or collapses every folder; the icon reflects the last action.
- **Files:** `apps/web/src/components/files/FileBrowserPanel.tsx`, `projectFilesQueryState.ts`, `apps/server/src/workspace/WorkspaceEntries.ts`, `WorkspaceFileSystem.ts`, `WorkspaceSearchIndex.ts`, `apps/server/src/ws.ts`, `packages/contracts/src/project.ts`, `rpc.ts`, `ipc.ts`, `packages/client-runtime/src/state/projectCommands.ts`, `apps/mobile/src/features/files/*`.

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

- `apps/web` (audio notification, completion banner trigger, Files panel UI)
- `apps/desktop` (OS notification IPC via Electron)
- `apps/server` (DeepSeek provider, driver, Codex harness parameterization, workspace file operations, `latestMessage` in thread shells)
- `packages/contracts` (settings schema: sound + notifications, file-entry RPCs, shell schema)
- `packages/client-runtime` (file-entry commands)
- `apps/mobile` (DeepSeek provider registration, all-files listing)

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
