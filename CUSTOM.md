# T3 Code Custom

> Personal fork of [pingdotgg/t3code](https://github.com/pingdotgg/t3code) with a small
> set of customizations. Written in English because it is committed to a public repo.

## Repository

| Remote                  | URL                                          | Access         |
| ----------------------- | -------------------------------------------- | -------------- |
| **origin** (our fork)   | `https://github.com/srmdn/t3code-custom.git` | fetch + push   |
| **upstream** (official) | `https://github.com/pingdotgg/t3code.git`    | **fetch only** |

## Golden Rules

- **NEVER push or open a PR against `upstream`.** Upstream is fetch/sync only. All
  pushes and PRs go to `origin` (this fork) only. Pushing to `upstream` is also
  disabled at the git level (`git remote set-url --push upstream DISABLED`).
- **NEVER install/update from official channels** (`npx t3@latest`, Homebrew,
  downloads from t3.codes, or the in-app auto-updater in Settings → About). Those
  ship pristine upstream and would silently overwrite these customizations.
- **Build from the fork only.** `srmdn/t3code-custom` is the single source of truth.
- **Never commit confidential data** (see [Confidentiality](#confidentiality)).

## Current base

`main` is built directly on the upstream release tag **`v0.0.42`**, with our
customizations re-applied on top as small, additive commits:

```
v0.0.42 (pingdotgg/t3code)
 └─ feat(deepseek): re-apply DeepSeek provider on upstream v0.0.42
     └─ feat(web): pick, preview, and set volume for the completion chime
         └─ chore(release): align package versions to 0.0.42
```

The previous fork (`v0.0.31` + old customizations) is preserved by the tag
`custom-v0.0.31` and can be checked out any time:

```
git checkout custom-v0.0.31
```

## Customizations

We deliberately keep only two features on top of upstream:

### 1. DeepSeek provider on the Codex harness

DeepSeek is a first-class tile whose execution engine is the **Codex CLI harness**
pointed at `~/.codex-deepseek`. The Codex adapter and session runtime are
parameterized by provider so one harness serves multiple provider identities.

- **Models follow the official DeepSeek API docs** (`api-docs.deepseek.com`):
  - `deepseek-flash` = **DeepSeek-V4.1-Flash** (vision-capable). Default.
  - `deepseek-v4-pro` (no vision).
  - Legacy/invalid slugs (`deepseek-v4-flash`, `deepseek-v4.1-flash`) are aliased to
    `deepseek-flash`, and the server normalizes the model by provider.
- **External config lives outside the repo:** `~/.codex-deepseek/config.toml`
  (model, provider, auth) and `~/.codex-deepseek/models.json` (Codex model catalog;
  must declare `input_modalities: ["text","image"]` for vision). Never commit
  anything from that directory — it contains credentials.
- Files: `apps/server/src/provider/Drivers/DeepSeekDriver.ts`,
  `apps/server/src/provider/Layers/DeepSeekProvider.ts`, plus parameterization in
  `CodexAdapter.ts` / `CodexSessionRuntime.ts`, contracts `settings.ts` / `model.ts`,
  and provider registration in web/mobile.

### 2. Completion chime: preset, preview, volume

Extends the **upstream** notification system (`notificationMode`) rather than
replacing it, so there is no double sound:

- `notificationSoundPreset` (classic-ding-dong, codex, hero, ping, rich-double) and
  `notificationSoundVolume` (0–100) in client settings; assets under
  `apps/web/public/sounds/`.
- `apps/web/src/threadNotifications.ts` plays the selected preset at the configured
  volume for completion events; `NotificationSettings.tsx` renders the preset picker,
  Preview button, and volume slider.

### Dropped from the old fork (intentionally)

The old fork's Files panel, its standalone sound hook/desktop-banner stack, and the
chat-only DeepSeek REST adapter are **gone**. Upstream v0.0.42 now covers files and
notifications; the old implementations were replaced. Recover them only if needed
from `custom-v0.0.31`.

## Syncing from Upstream

```
git fetch upstream
git switch main
git merge upstream/main
# resolve conflicts — expect them only in the DeepSeek / audio files above
git push origin main
```

Frequency: every 1–2 weeks, or when a needed upstream feature/fix lands.

## Local build (unsigned, personal use)

```
pnpm dist:desktop:dmg:arm64
```

Artifacts land in `release/` (`T3-Code-<version>-arm64.dmg` + `.zip`). The version
comes from the workspace `package.json` files; keep them aligned when bumping.

## Confidentiality

This repo is **public**. Before every commit/push, scan changed files for:

- Secrets: API keys, tokens, pairing URLs, `.env`, anything under `~/.codex-deepseek`.
- Data files: `*.db`, `*-wal`, `*-shm`.
- Personal machine/VPS details.
- Build output (`release/`, `dist/`) and test databases.

When in doubt, generalize. `CUSTOM.md` itself must stay free of credentials.

## Philosophy

Fork and merge — take upstream features and fixes without losing the small custom
set. Keep customizations additive and localized so syncing stays mechanical.
