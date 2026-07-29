import { useAtomValue } from "@effect/atom-react";
import type { OrchestrationLatestTurn, ScopedThreadRef } from "@t3tools/contracts";
import type { SoundPreset } from "@t3tools/contracts/settings";
import { Atom } from "effect/unstable/reactivity";
import { useEffect, useRef } from "react";
import { environmentThreadDetails } from "../state/threads";
import { usePrimarySettings } from "./useSettings";

const EMPTY_LATEST_TURN_ATOM = Atom.make<OrchestrationLatestTurn | null>(null).pipe(
  Atom.withLabel("web-useAgentCompletionSound:empty"),
);

const SOUND_URLS: Record<SoundPreset, string> = {
  "classic-ding-dong": "/sounds/classic-ding-dong.wav",
  codex: "/sounds/codex.wav",
  hero: "/sounds/hero.wav",
  ping: "/sounds/ping.wav",
  "rich-double": "/sounds/rich-double.wav",
};

function playSound(preset: SoundPreset, volume: number): void {
  const url = SOUND_URLS[preset];
  if (!url) return;

  try {
    const audio = new Audio(url);
    audio.volume = Math.max(0, Math.min(1, volume / 100));
    void audio.play();
  } catch {
    // Audio may be blocked by browser autoplay policy
  }
}

/**
 * Preview a sound preset at the given volume without needing a completed turn.
 * Returns a cleanup function that stops playback if still active.
 */
export function previewSound(preset: SoundPreset, volume: number): () => void {
  const url = SOUND_URLS[preset];
  if (!url) return () => {};

  try {
    const audio = new Audio(url);
    audio.volume = Math.max(0, Math.min(1, volume / 100));
    void audio.play();
    return () => {
      audio.pause();
      audio.currentTime = 0;
    };
  } catch {
    return () => {};
  }
}

export function useAgentCompletionSound(ref: ScopedThreadRef | null): void {
  const latestTurn = useAtomValue(
    ref === null ? EMPTY_LATEST_TURN_ATOM : environmentThreadDetails.latestTurnAtom(ref),
  );

  const settings = usePrimarySettings();
  const prevCompletedAtRef = useRef<string | null>(null);

  useEffect(() => {
    const completedAt = latestTurn?.completedAt ?? null;
    const prevCompletedAt = prevCompletedAtRef.current;
    const justCompleted = completedAt !== null && prevCompletedAt === null;

    if (justCompleted && settings.soundEnabled) {
      playSound(settings.soundPreset, settings.soundVolume);
    }

    prevCompletedAtRef.current = completedAt;
  }, [latestTurn?.completedAt, settings.soundEnabled, settings.soundPreset, settings.soundVolume]);
}
