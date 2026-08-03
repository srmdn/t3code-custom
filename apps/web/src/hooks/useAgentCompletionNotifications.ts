import { useEffect, useRef } from "react";

import { readLocalApi } from "../localApi";
import { useThreadShells } from "../state/entities";
import { usePrimarySettings } from "./useSettings";

/**
 * Fires an OS notification when any thread's latest turn completes while the
 * app is running. The first observation of each thread only establishes a
 * baseline, mirroring the completion-sound state machine, so opening an
 * already-finished thread does not notify.
 */
export function useAgentCompletionNotifications(): void {
  const shells = useThreadShells();
  const settings = usePrimarySettings();
  const completedAtByThreadRef = useRef(new Map<string, string | null>());

  useEffect(() => {
    if (!settings.completionNotificationsEnabled) {
      return;
    }
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
      void readLocalApi()?.notifications.show({
        title: "Agent finished",
        body: shell.title,
      });
    }
  }, [shells, settings.completionNotificationsEnabled]);
}
