import { DeepSeekSettings, ProviderDriverKind, type ServerProvider } from "@t3tools/contracts";
import * as Duration from "effect/Duration";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { HttpClient } from "effect/unstable/http";
import { ChildProcessSpawner } from "effect/unstable/process";

import { makeCodexTextGeneration } from "../../textGeneration/CodexTextGeneration.ts";
import * as BackgroundPolicy from "../../background/BackgroundPolicy.ts";
import { ServerConfig } from "../../config.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { ProviderDriverError } from "../Errors.ts";
import { makeCodexAdapter } from "../Layers/CodexAdapter.ts";
import {
  buildInitialDeepSeekProviderSnapshot,
  checkDeepSeekProviderStatus,
  deepSeekToCodexSettings,
  enrichDeepSeekSnapshot,
} from "../Layers/DeepSeekProvider.ts";
import { ProviderEventLoggers } from "../Layers/ProviderEventLoggers.ts";
import { makeManagedServerProvider } from "../makeManagedServerProvider.ts";
import type { ProviderDriver, ProviderInstance } from "../ProviderDriver.ts";
import type { ServerProviderDraft } from "../providerSnapshot.ts";
import { mergeProviderInstanceEnvironment } from "../ProviderInstanceEnvironment.ts";
import {
  makeManualOnlyProviderMaintenanceCapabilities,
  makeStaticProviderMaintenanceResolver,
  resolveProviderMaintenanceCapabilitiesEffect,
} from "../providerMaintenance.ts";
import {
  haveProviderSnapshotSettingsChanged,
  makeProviderSnapshotSettingsSource,
  type ProviderSnapshotSettings,
} from "../providerUpdateSettings.ts";
import { materializeCodexShadowHome, resolveCodexHomeLayout } from "./CodexHomeLayout.ts";

const decodeDeepSeekSettings = Schema.decodeSync(DeepSeekSettings);

const DRIVER_KIND = ProviderDriverKind.make("deepseek");
const SNAPSHOT_REFRESH_INTERVAL = Duration.minutes(5);
const DEFAULT_HOME_PATH = "~/.codex-deepseek";
const UPDATE = makeStaticProviderMaintenanceResolver(
  makeManualOnlyProviderMaintenanceCapabilities({
    provider: DRIVER_KIND,
    packageName: null,
  }),
);

export type DeepSeekDriverEnv =
  | BackgroundPolicy.BackgroundPolicy
  | ChildProcessSpawner.ChildProcessSpawner
  | Crypto.Crypto
  | FileSystem.FileSystem
  | HttpClient.HttpClient
  | Path.Path
  | ProviderEventLoggers
  | ServerConfig
  | ServerSettingsService;

const withInstanceIdentity =
  (input: {
    readonly instanceId: ProviderInstance["instanceId"];
    readonly displayName: string | undefined;
    readonly accentColor: string | undefined;
    readonly continuationGroupKey: string;
  }) =>
  (snapshot: ServerProviderDraft): ServerProvider => ({
    ...snapshot,
    instanceId: input.instanceId,
    driver: DRIVER_KIND,
    ...(input.displayName ? { displayName: input.displayName } : {}),
    ...(input.accentColor ? { accentColor: input.accentColor } : {}),
    continuation: { groupKey: input.continuationGroupKey },
  });

export const DeepSeekDriver: ProviderDriver<DeepSeekSettings, DeepSeekDriverEnv> = {
  driverKind: DRIVER_KIND,
  metadata: {
    displayName: "DeepSeek",
    supportsMultipleInstances: true,
  },
  configSchema: DeepSeekSettings,
  defaultConfig: (): DeepSeekSettings => decodeDeepSeekSettings({}),
  create: ({ instanceId, displayName, accentColor, environment, enabled, config }) =>
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const crypto = yield* Crypto.Crypto;
      const serverSettings = yield* ServerSettingsService;
      const eventLoggers = yield* ProviderEventLoggers;
      const httpClient = yield* HttpClient.HttpClient;
      const processEnv = mergeProviderInstanceEnvironment(environment);
      const homePath = config.homePath.trim().length > 0 ? config.homePath : DEFAULT_HOME_PATH;
      const homeLayout = yield* resolveCodexHomeLayout(
        deepSeekToCodexSettings({ ...config, homePath }),
      );
      const continuationIdentity = {
        driverKind: DRIVER_KIND,
        continuationKey: homeLayout.continuationKey,
      };
      const stampIdentity = withInstanceIdentity({
        instanceId,
        displayName,
        accentColor,
        continuationGroupKey: continuationIdentity.continuationKey,
      });
      yield* materializeCodexShadowHome(homeLayout).pipe(
        Effect.mapError(
          (cause) =>
            new ProviderDriverError({
              driver: DRIVER_KIND,
              instanceId,
              detail: cause.message,
              cause,
            }),
        ),
      );
      const effectiveConfig = {
        ...config,
        enabled,
        homePath,
      } satisfies DeepSeekSettings;
      const maintenanceCapabilities = yield* resolveProviderMaintenanceCapabilitiesEffect(UPDATE, {
        binaryPath: effectiveConfig.binaryPath,
        env: processEnv,
      });

      const codexConfig = deepSeekToCodexSettings(effectiveConfig);
      const adapter = yield* makeCodexAdapter(codexConfig, {
        instanceId,
        provider: DRIVER_KIND,
        environment: processEnv,
        ...(eventLoggers.native ? { nativeEventLogger: eventLoggers.native } : {}),
      });
      const textGeneration = yield* makeCodexTextGeneration(codexConfig, processEnv);

      const checkProvider = checkDeepSeekProviderStatus(effectiveConfig, processEnv).pipe(
        Effect.map(stampIdentity),
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        Effect.provideService(Crypto.Crypto, crypto),
      );

      const snapshotSettings = makeProviderSnapshotSettingsSource(effectiveConfig, serverSettings);
      const snapshot = yield* makeManagedServerProvider<ProviderSnapshotSettings<DeepSeekSettings>>(
        {
          maintenanceCapabilities,
          getSettings: snapshotSettings.getSettings,
          streamSettings: snapshotSettings.streamSettings,
          haveSettingsChanged: haveProviderSnapshotSettingsChanged,
          initialSnapshot: (settings) =>
            buildInitialDeepSeekProviderSnapshot(settings.provider).pipe(Effect.map(stampIdentity)),
          checkProvider,
          enrichSnapshot: ({ settings, snapshot: currentSnapshot, publishSnapshot }) =>
            enrichDeepSeekSnapshot({
              snapshot: currentSnapshot,
              maintenanceCapabilities,
              enableProviderUpdateChecks: settings.enableProviderUpdateChecks,
              publishSnapshot,
              httpClient,
            }),
          refreshInterval: SNAPSHOT_REFRESH_INTERVAL,
        },
      ).pipe(
        Effect.mapError(
          (cause) =>
            new ProviderDriverError({
              driver: DRIVER_KIND,
              instanceId,
              detail: `Failed to build DeepSeek snapshot: ${cause.message ?? String(cause)}`,
              cause,
            }),
        ),
      );

      return {
        instanceId,
        driverKind: DRIVER_KIND,
        continuationIdentity,
        displayName,
        accentColor,
        enabled,
        snapshot,
        adapter,
        textGeneration,
      } satisfies ProviderInstance;
    }),
};
