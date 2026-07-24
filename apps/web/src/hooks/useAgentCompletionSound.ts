import { useAtomValue } from "@effect/atom-react";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useEffect, useRef } from "react";
import { environmentThreadDetails } from "../state/threads";

const C5_FREQUENCY = 523.25;
const E5_FREQUENCY = 659.25;
const FIRST_TONE_DURATION = 0.15;
const SECOND_TONE_START = 0.12;
const SECOND_TONE_DURATION = 0.23;
const DECAY_DURATION = 0.4;
const VOLUME = 0.15;
const CLEANUP_DELAY = 500;

function playCompletionChime(): void {
  try {
    const ctx = new AudioContext();
    const now = ctx.currentTime;

    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(VOLUME, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + DECAY_DURATION);

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

export function useAgentCompletionSound(ref: ScopedThreadRef | null): void {
  const latestTurn = useAtomValue(
    ref === null ? null : environmentThreadDetails.latestTurnAtom(ref),
  );

  const prevCompletedAtRef = useRef<string | null>(null);

  useEffect(() => {
    const completedAt = latestTurn?.completedAt ?? null;
    const prevCompletedAt = prevCompletedAtRef.current;
    const justCompleted = completedAt !== null && prevCompletedAt === null;

    if (justCompleted) {
      playCompletionChime();
    }

    prevCompletedAtRef.current = completedAt;
  }, [latestTurn?.completedAt]);
}
