import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import { describe, expect, it } from "vite-plus/test";
import { DeepSeekSettings } from "@t3tools/contracts";

import {
  buildInitialDeepSeekProviderSnapshot,
  checkDeepSeekProviderStatus,
} from "./DeepSeekProvider.ts";

const decodeDeepSeekSettings = Schema.decodeSync(DeepSeekSettings);

const runNode = <A, E>(
  effect: Effect.Effect<A, E, ChildProcessSpawner.ChildProcessSpawner>,
): Promise<A> => Effect.runPromise(effect.pipe(Effect.provide(NodeServices.layer)));

describe("buildInitialDeepSeekProviderSnapshot", () => {
  it("reports a disabled instance without touching the harness", async () => {
    const snapshot = await runNode(
      buildInitialDeepSeekProviderSnapshot(decodeDeepSeekSettings({ enabled: false })),
    );

    expect(snapshot.displayName).toBe("DeepSeek");
    expect(snapshot.enabled).toBe(false);
    expect(snapshot.status).toBe("disabled");
    expect(snapshot.message).toBe("DeepSeek is disabled in T3 Code settings.");
  });

  it("reports a pending snapshot for an enabled instance", async () => {
    const snapshot = await runNode(
      buildInitialDeepSeekProviderSnapshot(decodeDeepSeekSettings({})),
    );

    expect(snapshot.displayName).toBe("DeepSeek");
    expect(snapshot.enabled).toBe(true);
    expect(snapshot.showInteractionModeToggle).toBe(true);
    expect(snapshot.models.map((model) => model.slug)).toEqual([
      "deepseek-v4-pro",
      "deepseek-v4-flash",
    ]);
    expect(snapshot.message).toBe(
      "DeepSeek provider status has not been checked in this session yet.",
    );
  });
});

describe("checkDeepSeekProviderStatus", () => {
  it("reports a disabled instance without spawning the binary", async () => {
    const snapshot = await runNode(
      checkDeepSeekProviderStatus(decodeDeepSeekSettings({ enabled: false })),
    );

    expect(snapshot.displayName).toBe("DeepSeek");
    expect(snapshot.enabled).toBe(false);
    expect(snapshot.status).toBe("disabled");
    expect(snapshot.message).toBe("DeepSeek is disabled in T3 Code settings.");
  });
});
