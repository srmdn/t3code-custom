import { executeAtomQuery } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import * as Option from "effect/Option";
import { useEffect, useRef } from "react";

import { readLocalApi } from "../localApi";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { useThreadShells } from "../state/entities";
import { environmentThreads } from "../state/threads";
import { playCompletionSound } from "./useAgentCompletionSound";
import { usePrimarySettings } from "./useSettings";

async function lastThreadMessageText(shell: EnvironmentThreadShell): Promise<string | null> {
  const atom = environmentThreads.stateAtom(shell.environmentId, shell.id);
  const result = await executeAtomQuery(appAtomRegistry, atom, {
    reportDefect: false,
    reportFailure: false,
  });
  if (result._tag !== "Success") {
    return null;
  }
  const state = appAtomRegistry.get(atom);
  if (state._tag !== "Success") {
    return null;
  }
  const thread = Option.getOrNull(state.value.data);
  if (thread === null) {
    return null;
  }
  for (let index = thread.messages.length - 1; index >= 0; index -= 1) {
    const message = thread.messages[index];
    if (message?.role === "assistant" && message.text.trim().length > 0) {
      return message.text;
    }
  }
  for (let index = thread.messages.length - 1; index >= 0; index -= 1) {
    const message = thread.messages[index];
    if (message?.role === "user" && message.text.trim().length > 0) {
      return message.text;
    }
  }
  return null;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

/**
 * Plays the completion sound and fires an OS notification when any thread's
 * latest turn completes. Both are driven by the same transition so they stay
 * in sync; the notification body is the thread's latest message, preferring
 * the agent's final output. The first observation of each thread only
 * establishes a baseline, so opening an already-finished thread does not
 * notify.
 */
export function useAgentCompletionNotifications(): void {
  const shells = useThreadShells();
  const settings = usePrimarySettings();
  const completedAtByThreadRef = useRef(new Map<string, string | null>());

  useEffect(() => {
    for (const shell of shells) {
      const threadKey = `${shell.environmentId}:${shell.id}`;
      const completedAt = shell.latestTurn?.completedAt ?? null;
      const previous = completedAtByThreadRef.current.get(threadKey);
      if (previous === undefined) {
        completedAtByThreadRef.current.set(threadKey, completedAt);
        continue;
      }
      completedAtByThreadRef.current.set(threadKey, completedAt);
      if (previous !== null || completedAt === null) {
        continue;
      }
      void (async () => {
        if (settings.soundEnabled) {
          playCompletionSound(settings.soundPreset, settings.soundVolume);
        }
        if (!settings.completionNotificationsEnabled) {
          return;
        }
        const body = (await withTimeout(lastThreadMessageText(shell), 1200)) ?? shell.title;
        try {
          await readLocalApi()?.notifications.show({
            title: "Agent finished",
            body,
          });
        } catch (error) {
          console.error("Failed to show completion notification", error);
        }
      })();
    }
  }, [
    shells,
    settings.completionNotificationsEnabled,
    settings.soundEnabled,
    settings.soundPreset,
    settings.soundVolume,
  ]);
}
