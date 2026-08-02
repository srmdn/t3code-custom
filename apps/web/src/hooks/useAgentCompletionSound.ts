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

export interface ThreadCompletionState {
  readonly observed: boolean;
  readonly completedAt: string | null;
}

/**
 * Decide whether a completion sound should play for one thread observation.
 *
 * The first observation of a thread only establishes a baseline, so opening
 * an already-finished thread does not chime. Sound plays only when the same
 * thread moves from an unfinished latest turn to a completed one.
 */
export function nextCompletionSoundState(
  previous: ThreadCompletionState | undefined,
  completedAt: string | null,
): { readonly state: ThreadCompletionState; readonly shouldPlay: boolean } {
  const state: ThreadCompletionState = { observed: true, completedAt };
  if (previous === undefined) {
    return { state, shouldPlay: false };
  }
  return { state, shouldPlay: previous.completedAt === null && completedAt !== null };
}

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
  const completionStatesRef = useRef(new Map<string, ThreadCompletionState>());
  const threadKey = ref === null ? "" : `${ref.environmentId}:${ref.threadId}`;

  useEffect(() => {
    const completedAt = latestTurn?.completedAt ?? null;
    const { state, shouldPlay } = nextCompletionSoundState(
      completionStatesRef.current.get(threadKey),
      completedAt,
    );
    completionStatesRef.current.set(threadKey, state);

    if (shouldPlay && settings.soundEnabled) {
      playSound(settings.soundPreset, settings.soundVolume);
    }
  }, [
    threadKey,
    latestTurn?.completedAt,
    settings.soundEnabled,
    settings.soundPreset,
    settings.soundVolume,
  ]);
}
