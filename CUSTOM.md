# T3 Code Custom

> Fork pribadi dari [pingdotgg/t3code](https://github.com/pingdotgg/t3code) dengan kustomisasi UI/UX.

## Repo

| Remote                  | URL                                          |
| ----------------------- | -------------------------------------------- |
| **origin** (fork kita)  | `https://github.com/srmdn/t3code-custom.git` |
| **upstream** (official) | `https://github.com/pingdotgg/t3code.git`    |

## Aturan Utama

- **JANGAN PERNAH push atau buka PR ke upstream.** Upstream cuma buat fetch/sync.
- **JANGAN PERNAH download/update dari kanal official** (`npx t3@latest`, Homebrew, download dari t3.codes, Settings > About auto-updater). Semua kanal itu ngasih upstream murni — bakal timpa custom kita.
- **Build dari fork sendiri.** `srmdn/t3code-custom` adalah satu-satunya source of truth.

## Daftar Kustomisasi (5 commit di atas upstream `bb38c332`)

| Commit     | Deskripsi                                           | File                                                              |
| ---------- | --------------------------------------------------- | ----------------------------------------------------------------- |
| `84019c79` | feat: sound notification when agent completes work  | `ChatView.tsx`, `useAgentCompletionSound.ts` (new)                |
| `f3420876` | chore: hard rule — never PR to upstream             | `AGENTS.md`                                                       |
| `db23531d` | fix: useAtomValue(null) crashes React               | `useAgentCompletionSound.ts`                                      |
| `c8160ec6` | feat: sound notification settings (toggle + volume) | `SettingsPanels.tsx`, `useAgentCompletionSound.ts`, `settings.ts` |
| `b69533b2` | fix: volume slider missing CSS custom properties    | `SettingsPanels.tsx`                                              |

**Scope:** Semua kustomisasi ada di layer UI (`apps/web/`) dan kontrak settings (`packages/contracts/`). Tidak menyentuh server, provider integration, atau core protocol. Risiko konflik merge rendah.

## Konfigurasi Tambahan

- **GitHub Actions:** Disabled (`enabled: false`). Workflow upstream (CI, Deploy T3 Connect relay, Mobile EAS Preview) tidak relevan untuk fork pribadi dan cuma bikin job stuck.
- **`.gitignore`:** Ditambah `.sisyphus/` (direktori kerja agen AI).
- **Branch naming:** `feat/*`, `fix/*`, `chore/*`. Merge ke `main`, hapus branch setelah merge.

## Cara Update dari Upstream

```
# 1. Fetch perubahan terbaru dari upstream
git fetch upstream

# 2. Merge upstream ke main
git merge upstream/main

# 3. Resolve konflik jika ada (biasanya aman karena custom kita di layer UI aja)
# 4. Push ke origin
git push origin main
```

Frekuensi: setiap 1-2 minggu, atau saat ada fitur upstream yang dibutuhkan.

## Filosofi

Ini bukan "fork and forget" — ini **fork and merge**. Dapat fitur baru dan bugfix dari upstream tanpa kehilangan kustomisasi. Selama custom tetap di layer UI yang jarang disentuh upstream besar-besaran, strategi ini aman.
