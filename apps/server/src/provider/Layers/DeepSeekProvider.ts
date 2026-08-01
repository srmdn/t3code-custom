import {
  type DeepSeekSettings,
  type ModelCapabilities,
  type ServerProvider,
  type ServerProviderModel,
} from "@t3tools/contracts";
import { causeErrorTag } from "@t3tools/shared/observability";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import { createModelCapabilities } from "@t3tools/shared/model";

import {
  buildBooleanOptionDescriptor,
  buildServerProvider,
  buildSelectOptionDescriptor,
  providerModelsFromSettings,
  type ServerProviderDraft,
} from "../providerSnapshot.ts";
import {
  enrichProviderSnapshotWithVersionAdvisory,
  type ProviderMaintenanceCapabilities,
} from "../providerMaintenance.ts";

const DEEPSEEK_PRESENTATION = {
  displayName: "DeepSeek",
  badgeLabel: "API",
  showInteractionModeToggle: false,
  requiresNewThreadForModelChange: true,
} as const;

const DEEPSEEK_THINKING_OPTION = buildBooleanOptionDescriptor({
  id: "thinking",
  label: "Thinking",
  currentValue: true,
  description: "Enable DeepSeek thinking mode before the final answer.",
});

const DEEPSEEK_FLASH_EFFORT_OPTION = buildSelectOptionDescriptor({
  id: "effort",
  label: "Reasoning",
  options: [
    { value: "low", label: "Low" },
    { value: "high", label: "High", isDefault: true },
    { value: "max", label: "Max" },
  ],
});

const DEEPSEEK_PRO_EFFORT_OPTION = buildSelectOptionDescriptor({
  id: "effort",
  label: "Reasoning",
  options: [
    { value: "high", label: "High", isDefault: true },
    { value: "max", label: "Max" },
  ],
});

const DEEPSEEK_FLASH_MODEL_CAPABILITIES: ModelCapabilities = createModelCapabilities({
  optionDescriptors: [DEEPSEEK_THINKING_OPTION, DEEPSEEK_FLASH_EFFORT_OPTION],
});

const DEEPSEEK_PRO_MODEL_CAPABILITIES: ModelCapabilities = createModelCapabilities({
  optionDescriptors: [DEEPSEEK_THINKING_OPTION, DEEPSEEK_PRO_EFFORT_OPTION],
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

function resolveApiKey(settings: DeepSeekSettings, environment: NodeJS.ProcessEnv): string {
  return settings.apiKey || environment.DEEPSEEK_API_KEY || "";
}

export function buildInitialDeepSeekProviderSnapshot(
  deepSeekSettings: DeepSeekSettings,
): Effect.Effect<ServerProviderDraft> {
  return Effect.gen(function* () {
    const checkedAt = yield* Effect.map(DateTime.now, DateTime.formatIso);
    const models = deepSeekModelsFromSettings(deepSeekSettings.customModels);

    if (!deepSeekSettings.enabled) {
      return buildServerProvider({
        presentation: DEEPSEEK_PRESENTATION,
        enabled: false,
        checkedAt,
        models,
        probe: {
          installed: false,
          version: null,
          status: "warning",
          auth: { status: "unknown" },
          message: "DeepSeek is disabled in T3 Code settings.",
        },
      });
    }

    const apiKey = resolveApiKey(deepSeekSettings, process.env);
    if (!apiKey) {
      return buildServerProvider({
        presentation: DEEPSEEK_PRESENTATION,
        enabled: true,
        checkedAt,
        models,
        probe: {
          installed: true,
          version: null,
          status: "warning",
          auth: { status: "unauthenticated" },
          message:
            "DeepSeek API key not configured. Set it in Settings or via DEEPSEEK_API_KEY env var.",
        },
      });
    }

    return buildServerProvider({
      presentation: DEEPSEEK_PRESENTATION,
      enabled: true,
      checkedAt,
      models,
      probe: {
        installed: true,
        version: null,
        status: "ready",
        auth: { status: "authenticated" },
      },
    });
  });
}

export const checkDeepSeekProviderStatus = Effect.fn("checkDeepSeekProviderStatus")(function* (
  deepSeekSettings: DeepSeekSettings,
  environment: NodeJS.ProcessEnv = process.env,
): Effect.fn.Return<ServerProviderDraft, never> {
  const checkedAt = DateTime.formatIso(yield* DateTime.now);
  const fallbackModels = deepSeekModelsFromSettings(deepSeekSettings.customModels);

  if (!deepSeekSettings.enabled) {
    return buildServerProvider({
      presentation: DEEPSEEK_PRESENTATION,
      enabled: false,
      checkedAt,
      models: fallbackModels,
      probe: {
        installed: false,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: "DeepSeek is disabled in T3 Code settings.",
      },
    });
  }

  const apiKey = resolveApiKey(deepSeekSettings, environment);
  if (!apiKey) {
    return buildServerProvider({
      presentation: DEEPSEEK_PRESENTATION,
      enabled: true,
      checkedAt,
      models: fallbackModels,
      probe: {
        installed: true,
        version: null,
        status: "warning",
        auth: { status: "unauthenticated" },
        message:
          "DeepSeek API key not configured. Set it in Settings or via DEEPSEEK_API_KEY env var.",
      },
    });
  }

  return buildServerProvider({
    presentation: DEEPSEEK_PRESENTATION,
    enabled: deepSeekSettings.enabled,
    checkedAt,
    models: fallbackModels,
    probe: {
      installed: true,
      version: null,
      status: "ready",
      auth: { status: "authenticated" },
    },
  });
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
