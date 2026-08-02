import { describe, expect, it } from "vite-plus/test";

import { nextCompletionSoundState } from "./useAgentCompletionSound";

describe("nextCompletionSoundState", () => {
  it("establishes a baseline on first observation without playing", () => {
    const completedAt = "2026-08-02T10:00:00.000Z";
    const result = nextCompletionSoundState(undefined, completedAt);

    expect(result.shouldPlay).toBe(false);
    expect(result.state).toEqual({ observed: true, completedAt });
  });

  it("plays when an unfinished turn becomes completed", () => {
    const first = nextCompletionSoundState(undefined, null);
    const second = nextCompletionSoundState(first.state, "2026-08-02T10:00:00.000Z");

    expect(second.shouldPlay).toBe(true);
  });

  it("does not replay an already-completed turn", () => {
    const completedAt = "2026-08-02T10:00:00.000Z";
    const first = nextCompletionSoundState(undefined, completedAt);
    const second = nextCompletionSoundState(first.state, completedAt);

    expect(second.shouldPlay).toBe(false);
  });

  it("plays again for a later turn after a new turn starts", () => {
    let state = nextCompletionSoundState(undefined, null).state;
    const firstResult = nextCompletionSoundState(state, "turn-1-completed");
    expect(firstResult.shouldPlay).toBe(true);
    state = firstResult.state;

    const newTurn = nextCompletionSoundState(state, null);
    expect(newTurn.shouldPlay).toBe(false);

    const secondResult = nextCompletionSoundState(newTurn.state, "turn-2-completed");
    expect(secondResult.shouldPlay).toBe(true);
  });
});
