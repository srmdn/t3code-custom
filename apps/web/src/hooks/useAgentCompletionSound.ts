import { useAtomValue } from "@effect/atom-react";
import type { OrchestrationLatestTurn, ScopedThreadRef } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";
import { useEffect, useRef } from "react";
import { environmentThreadDetails } from "../state/threads";
import { usePrimarySettings } from "./useSettings";

const EMPTY_LATEST_TURN_ATOM = Atom.make<OrchestrationLatestTurn | null>(null).pipe(
  Atom.withLabel("web-useAgentCompletionSound:empty"),
);

const C5_FREQUENCY = 523.25;
const E5_FREQUENCY = 659.25;
const FIRST_TONE_DURATION = 0.15;
const SECOND_TONE_START = 0.12;
const SECOND_TONE_DURATION = 0.23;
const DECAY_DURATION = 0.4;
const CLEANUP_DELAY = 1000;

function playCompletionChime(volume: number): void {
  const normalizedVolume = Math.max(0, Math.min(1, volume / 100));

  try {
    const ctx = new AudioContext();
    const now = ctx.currentTime;

    const toneEnd = now + SECOND_TONE_START + SECOND_TONE_DURATION;
    const initialGain = normalizedVolume * VOLUME_MULTIPLIER;

    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(initialGain, now);
    gain.gain.setValueAtTime(initialGain, toneEnd);
    gain.gain.exponentialRampToValueAtTime(0.001, toneEnd + DECAY_DURATION);

    const firstTone = ctx.createOscillator();
    firstTone.type = "sine";
    firstTone.frequency.setValueAtTime(C5_FREQUENCY, now);
    firstTone.connect(gain);
    firstTone.start(now);
    firstTone.stop(now + FIRST_TONE_DURATION);

    const secondTone = ctx.createOscillator();
    secondTone.type = "sine";
    secondTone.frequency.setValueAtTime(E5_FREQUENCY, now + SECOND_TONE_START);
    secondTone.connect(gain);
    secondTone.start(now + SECOND_TONE_START);
    secondTone.stop(now + SECOND_TONE_START + SECOND_TONE_DURATION);

    setTimeout(() => {
      void ctx.close();
    }, CLEANUP_DELAY);
  } catch {
    // AudioContext may be blocked by browser autoplay policy
  }
}

const VOLUME_MULTIPLIER = 1.0;

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
      playCompletionChime(settings.soundVolume);
    }

    prevCompletedAtRef.current = completedAt;
  }, [latestTurn?.completedAt, settings.soundEnabled, settings.soundVolume]);
}
