import { useEffect, useRef } from "react";

import { readLocalApi } from "../localApi";
import { useThreadShells } from "../state/entities";
import { playCompletionSound } from "./useAgentCompletionSound";
import { usePrimarySettings } from "./useSettings";

/**
 * Plays the completion sound and fires an OS notification when any thread's
 * latest turn completes. Both are driven by the same transition so they stay
 * in sync; the notification body is the shell's latest message (the agent's
 * final output once the turn completes), falling back to the thread title.
 * The first observation of each thread only establishes a baseline, so
 * opening an already-finished thread does not notify.
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
        const body = shell.latestMessage ?? shell.title;
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
