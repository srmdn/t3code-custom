import {
  CodexSettings,
  type DeepSeekSettings,
  type ModelCapabilities,
  type ServerProvider,
  type ServerProviderModel,
  ServerSettingsError,
} from "@t3tools/contracts";
import { causeErrorTag } from "@t3tools/shared/observability";
import { createModelCapabilities } from "@t3tools/shared/model";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";

import {
  enrichProviderSnapshotWithVersionAdvisory,
  type ProviderMaintenanceCapabilities,
} from "../providerMaintenance.ts";
import {
  buildSelectOptionDescriptor,
  providerModelsFromSettings,
  type ServerProviderDraft,
} from "../providerSnapshot.ts";
import { checkCodexProviderStatus, makePendingCodexProvider } from "./CodexProvider.ts";

const DEEPSEEK_PRESENTATION = {
  displayName: "DeepSeek",
  badgeLabel: "API",
  showInteractionModeToggle: true,
  requiresNewThreadForModelChange: true,
} as const;

const DEEPSEEK_FLASH_EFFORT_OPTION = buildSelectOptionDescriptor({
  id: "reasoningEffort",
  label: "Reasoning",
  options: [
    { value: "low", label: "Low" },
    { value: "high", label: "High", isDefault: true },
    { value: "max", label: "Max" },
  ],
});

const DEEPSEEK_PRO_EFFORT_OPTION = buildSelectOptionDescriptor({
  id: "reasoningEffort",
  label: "Reasoning",
  options: [
    { value: "high", label: "High", isDefault: true },
    { value: "max", label: "Max" },
  ],
});

const DEEPSEEK_FLASH_MODEL_CAPABILITIES: ModelCapabilities = createModelCapabilities({
  optionDescriptors: [DEEPSEEK_FLASH_EFFORT_OPTION],
});

const DEEPSEEK_PRO_MODEL_CAPABILITIES: ModelCapabilities = createModelCapabilities({
  optionDescriptors: [DEEPSEEK_PRO_EFFORT_OPTION],
});

const DEEPSEEK_BUILT_IN_MODELS: ReadonlyArray<ServerProviderModel> = [
  {
    slug: "deepseek-v4-pro",
    name: "DeepSeek V4 Pro",
    isCustom: false,
    capabilities: DEEPSEEK_PRO_MODEL_CAPABILITIES,
  },
  {
    slug: "deepseek-v4-flash",
    name: "DeepSeek V4 Flash",
    isCustom: false,
    capabilities: DEEPSEEK_FLASH_MODEL_CAPABILITIES,
  },
];

function deepSeekModelsFromSettings(
  customModels: ReadonlyArray<string> | undefined,
  builtInModels: ReadonlyArray<ServerProviderModel> = DEEPSEEK_BUILT_IN_MODELS,
): ReadonlyArray<ServerProviderModel> {
  return providerModelsFromSettings(
    builtInModels,
    customModels ?? [],
    DEEPSEEK_FLASH_MODEL_CAPABILITIES,
  );
}

/**
 * DeepSeek runs on the Codex harness pointed at its own home directory
 * (`~/.codex-deepseek`). Map `DeepSeekSettings` onto `CodexSettings` so the
 * codex app-server helpers can be reused unchanged; any CodexSettings field
 * the DeepSeek schema does not expose falls back to its schema default.
 */
const decodeCodexSettings = Schema.decodeSync(CodexSettings);

export function deepSeekToCodexSettings(settings: DeepSeekSettings): CodexSettings {
  return decodeCodexSettings({
    enabled: settings.enabled,
    binaryPath: settings.binaryPath,
    homePath: settings.homePath,
    customModels: settings.customModels,
  });
}

function withDeepSeekPresentation(
  draft: ServerProviderDraft,
  customModels: ReadonlyArray<string> | undefined,
): ServerProviderDraft {
  return {
    ...draft,
    displayName: DEEPSEEK_PRESENTATION.displayName,
    ...(DEEPSEEK_PRESENTATION.badgeLabel ? { badgeLabel: DEEPSEEK_PRESENTATION.badgeLabel } : {}),
    ...(typeof DEEPSEEK_PRESENTATION.showInteractionModeToggle === "boolean"
      ? { showInteractionModeToggle: DEEPSEEK_PRESENTATION.showInteractionModeToggle }
      : {}),
    ...(typeof DEEPSEEK_PRESENTATION.requiresNewThreadForModelChange === "boolean"
      ? { requiresNewThreadForModelChange: DEEPSEEK_PRESENTATION.requiresNewThreadForModelChange }
      : {}),
    models: deepSeekModelsFromSettings(customModels),
    ...(draft.message ? { message: draft.message.replaceAll("Codex", "DeepSeek") } : {}),
  };
}

export function buildInitialDeepSeekProviderSnapshot(
  deepSeekSettings: DeepSeekSettings,
): Effect.Effect<ServerProviderDraft> {
  return Effect.map(makePendingCodexProvider(deepSeekToCodexSettings(deepSeekSettings)), (draft) =>
    withDeepSeekPresentation(draft, deepSeekSettings.customModels),
  );
}

export const checkDeepSeekProviderStatus = Effect.fn("checkDeepSeekProviderStatus")(function* (
  deepSeekSettings: DeepSeekSettings,
  environment: NodeJS.ProcessEnv = process.env,
): Effect.fn.Return<
  ServerProviderDraft,
  ServerSettingsError,
  ChildProcessSpawner.ChildProcessSpawner
> {
  const draft = yield* checkCodexProviderStatus(
    deepSeekToCodexSettings(deepSeekSettings),
    undefined,
    environment,
  );
  return withDeepSeekPresentation(draft, deepSeekSettings.customModels);
});

export const enrichDeepSeekSnapshot = (input: {
  readonly snapshot: ServerProvider;
  readonly maintenanceCapabilities: ProviderMaintenanceCapabilities;
  readonly enableProviderUpdateChecks?: boolean;
  readonly publishSnapshot: (snapshot: ServerProvider) => Effect.Effect<void>;
}): Effect.Effect<void> => {
  const { snapshot, publishSnapshot } = input;

  return enrichProviderSnapshotWithVersionAdvisory(snapshot, input.maintenanceCapabilities, {
    enableProviderUpdateChecks: input.enableProviderUpdateChecks,
  }).pipe(
    Effect.flatMap((enrichedSnapshot) => publishSnapshot(enrichedSnapshot)),
    Effect.catchCause((cause) =>
      Effect.logWarning("DeepSeek version advisory enrichment failed", {
        errorTag: causeErrorTag(cause),
      }),
    ),
    Effect.asVoid,
  );
};
