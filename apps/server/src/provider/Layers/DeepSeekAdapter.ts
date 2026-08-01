import {
  ApprovalRequestId,
  type DeepSeekSettings,
  EventId,
  type ProviderApprovalDecision,
  type ProviderRuntimeEvent,
  type ProviderSession,
  type ProviderUserInputAnswers,
  ProviderDriverKind,
  ProviderInstanceId,
  RuntimeRequestId,
  RuntimeItemId,
  type ThreadId,
  type ThreadTokenUsageSnapshot,
  TurnId,
} from "@t3tools/contracts";
import {
  getModelSelectionStringOptionValue,
  getModelSelectionBooleanOptionValue,
} from "@t3tools/shared/model";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";

import { resolveAttachmentPath } from "../../attachmentStore.ts";
import { ServerConfig } from "../../config.ts";
import {
  ProviderAdapterProcessError,
  ProviderAdapterRequestError,
  ProviderAdapterSessionClosedError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
  type ProviderAdapterError,
} from "../Errors.ts";
import type { ProviderAdapterShape } from "../Services/ProviderAdapter.ts";

// ── Types ─────────────────────────────────────────────────────────────

const PROVIDER = ProviderDriverKind.make("deepseek");

interface PendingApproval {
  readonly decision: Deferred.Deferred<ProviderApprovalDecision>;
}

interface PendingUserInput {
  readonly resolution: Deferred.Deferred<
    | { readonly _tag: "answered"; readonly answers: ProviderUserInputAnswers }
    | { readonly _tag: "cancelled" }
  >;
}

interface DeepSeekSessionContext {
  readonly session: ProviderSession;
  readonly messages: Array<DeepSeekMessage>;
  stopped: boolean;
  currentTurnAbort: AbortController | null;
  pendingApproval: Map<string, PendingApproval>;
  pendingUserInput: PendingUserInput | null;
  publishEvent: (event: ProviderRuntimeEvent) => Effect.Effect<void>;
}

type DeepSeekContentPart =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "image_url"; readonly image_url: { readonly url: string } };

interface DeepSeekMessage {
  readonly role: "system" | "user" | "assistant" | "tool";
  readonly content: string | null | Array<DeepSeekContentPart>;
  readonly tool_calls?: Array<{
    readonly id: string;
    readonly type: "function";
    readonly function: { readonly name: string; readonly arguments: string };
  }>;
  readonly tool_call_id?: string;
}

interface DeepSeekStreamChunk {
  readonly id?: string;
  readonly choices?: Array<{
    readonly index?: number;
    readonly delta?: {
      readonly role?: string;
      readonly content?: string | null;
      readonly reasoning_content?: string | null;
      readonly tool_calls?: Array<{
        readonly index?: number;
        readonly id?: string;
        readonly type?: "function";
        readonly function?: { readonly name?: string; readonly arguments?: string };
      }>;
    };
    readonly finish_reason?: string | null;
  }>;
  readonly usage?: {
    readonly prompt_tokens: number;
    readonly completion_tokens: number;
    readonly total_tokens: number;
  };
}

// ── Options ────────────────────────────────────────────────────────────

export interface DeepSeekAdapterLiveOptions {
  readonly environment?: NodeJS.ProcessEnv;
  readonly nativeEventLogger?: unknown;
  readonly instanceId?: ProviderInstanceId;
}

// ── Helpers ────────────────────────────────────────────────────────────

function resolveApiKey(settings: DeepSeekSettings, environment?: NodeJS.ProcessEnv): string {
  return settings.apiKey || environment?.DEEPSEEK_API_KEY || "";
}

function resolveBaseUrl(settings: DeepSeekSettings): string {
  return settings.baseUrl || "https://api.deepseek.com";
}

function resolveModel(settings: DeepSeekSettings): string {
  return settings.model || "deepseek-v4-pro";
}

function streamKindForChunk(
  chunk: DeepSeekStreamChunk,
): "assistant_text" | "reasoning_text" | null {
  const delta = chunk.choices?.[0]?.delta;
  if (!delta) return null;
  if (typeof delta.content === "string" && delta.content.length > 0) return "assistant_text";
  if (typeof delta.reasoning_content === "string" && delta.reasoning_content.length > 0) {
    return "reasoning_text";
  }
  return null;
}

function chunkText(chunk: DeepSeekStreamChunk): string | null {
  const delta = chunk.choices?.[0]?.delta;
  if (!delta) return null;
  if (typeof delta.content === "string" && delta.content.length > 0) return delta.content;
  if (typeof delta.reasoning_content === "string" && delta.reasoning_content.length > 0) {
    return delta.reasoning_content;
  }
  return null;
}

// ── SSE Parser ─────────────────────────────────────────────────────────

async function* parseSSEStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): AsyncGenerator<DeepSeekStreamChunk> {
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("data: ")) continue;
      const data = trimmed.slice(6);
      if (data === "[DONE]") return;
      try {
        yield JSON.parse(data) as DeepSeekStreamChunk;
      } catch {}
    }
  }
}

// ── API Calls ──────────────────────────────────────────────────────────

function buildRequestBody(
  settings: DeepSeekSettings,
  messages: Array<DeepSeekMessage>,
  effort?: string,
  thinking?: boolean,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: resolveModel(settings),
    messages,
    stream: true,
    stream_options: { include_usage: true },
  };
  if (effort) {
    body.reasoning_effort = effort;
  }
  if (thinking !== undefined) {
    body.thinking = { type: thinking ? "enabled" : "disabled" };
  }
  return body;
}

function makeApiRequest(
  settings: DeepSeekSettings,
  environment: NodeJS.ProcessEnv | undefined,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Response> {
  const apiKey = resolveApiKey(settings, environment);
  const baseUrl = resolveBaseUrl(settings);
  return fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal,
  });
}

// ── Error Mapping ──────────────────────────────────────────────────────

function toAdapterError(status: number, body: string, method: string): ProviderAdapterError {
  if (status === 401 || status === 403) {
    return new ProviderAdapterRequestError({
      provider: PROVIDER,
      method,
      detail: "DeepSeek API authentication failed. Check your API key.",
    });
  }
  if (status === 429) {
    return new ProviderAdapterRequestError({
      provider: PROVIDER,
      method,
      detail: "DeepSeek API rate limit exceeded. Try again later.",
    });
  }
  return new ProviderAdapterRequestError({
    provider: PROVIDER,
    method,
    detail: `DeepSeek API error (${status}): ${body.slice(0, 200)}`,
  });
}

// ── Runtime Helpers ────────────────────────────────────────────────────

function makeEventBase(
  eventId: string,
  createdAt: string,
  threadId: ThreadId,
  turnId?: TurnId,
  requestId?: RuntimeRequestId,
  itemId?: RuntimeItemId,
): Omit<ProviderRuntimeEvent, "type" | "payload"> {
  return {
    eventId: EventId.make(eventId),
    provider: PROVIDER,
    threadId,
    createdAt,
    ...(turnId ? { turnId } : {}),
    ...(requestId ? { requestId } : {}),
    ...(itemId ? { itemId } : {}),
  };
}

// ── Adapter Factory ────────────────────────────────────────────────────

export function makeDeepSeekAdapter(
  settings: DeepSeekSettings,
  options?: DeepSeekAdapterLiveOptions,
) {
  return Effect.gen(function* () {
    const instanceId = options?.instanceId ?? ProviderInstanceId.make("deepseek");
    const apiKey = resolveApiKey(settings, options?.environment);
    if (!apiKey) {
      return yield* new ProviderAdapterValidationError({
        provider: PROVIDER,
        operation: "startSession",
        issue:
          "DeepSeek API key not configured. Set it in Settings → DeepSeek or via DEEPSEEK_API_KEY env var.",
      });
    }

    const crypto = yield* Crypto.Crypto;
    const fileSystem = yield* FileSystem.FileSystem;
    const serverConfig = yield* Effect.service(ServerConfig);

    // ── State ──────────────────────────────────────────────────────────
    const sessions = new Map<ThreadId, DeepSeekSessionContext>();
    const runtimeEventPubSub = yield* PubSub.unbounded<ProviderRuntimeEvent>();

    const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
    const nextUuid = crypto.randomUUIDv4;
    const nextEventId = Effect.map(nextUuid, (id) => EventId.make(id));
    const makeEventStamp = () => Effect.all({ eventId: nextEventId, createdAt: nowIso });

    const publishEvent = (event: ProviderRuntimeEvent) => PubSub.publish(runtimeEventPubSub, event);

    const makePublish =
      (threadId: ThreadId, turnId?: TurnId) =>
      (
        type: ProviderRuntimeEvent["type"],
        payload: ProviderRuntimeEvent["payload"],
        requestId?: RuntimeRequestId,
        itemId?: RuntimeItemId,
      ) =>
        Effect.gen(function* () {
          const { eventId, createdAt } = yield* makeEventStamp();
          yield* publishEvent({
            ...makeEventBase(eventId, createdAt, threadId, turnId, requestId, itemId),
            type,
            payload,
          } as ProviderRuntimeEvent);
        });

    function requireSession(threadId: ThreadId): Effect.Effect<DeepSeekSessionContext> {
      const ctx = sessions.get(threadId);
      if (!ctx) {
        return Effect.fail(
          new ProviderAdapterSessionNotFoundError({
            provider: PROVIDER,
            threadId,
          }),
        );
      }
      if (ctx.stopped) {
        return Effect.fail(
          new ProviderAdapterSessionClosedError({
            provider: PROVIDER,
            threadId,
            detail: "Session has been stopped.",
          }),
        );
      }
      return Effect.succeed(ctx);
    }

    // ── Session Lifecycle ──────────────────────────────────────────────

    const startSession: ProviderAdapterShape<ProviderAdapterError>["startSession"] = (input) =>
      Effect.gen(function* () {
        const threadId = input.threadId;
        if (sessions.has(threadId)) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "startSession",
            issue: `A session already exists for thread ${threadId}.`,
          });
        }

        const publish = makePublish(threadId);
        const now = DateTime.formatIso(yield* DateTime.now);

        const session: ProviderSession = {
          threadId,
          provider: PROVIDER,
          providerInstanceId: instanceId,
          status: "ready",
          runtimeMode: input.runtimeMode,
          model: resolveModel(settings),
          ...(input.cwd ? { cwd: input.cwd } : {}),
          createdAt: now,
          updatedAt: now,
        };

        const ctx: DeepSeekSessionContext = {
          session,
          messages: [],
          stopped: false,
          currentTurnAbort: null,
          pendingApproval: new Map(),
          pendingUserInput: null,
          publishEvent: (event) => publishEvent(event),
        };

        sessions.set(threadId, ctx);

        yield* publish("session.started", { message: "DeepSeek session started." });
        yield* publish("session.state.changed", { state: "ready" });

        return session;
      });

    // ── Send Turn ──────────────────────────────────────────────────────

    const sendTurn: ProviderAdapterShape<ProviderAdapterError>["sendTurn"] = (input) =>
      Effect.gen(function* () {
        const ctx = yield* requireSession(input.threadId);
        const turnId = TurnId.make(yield* nextUuid);
        const assistantItemId = RuntimeItemId.make(yield* nextUuid);
        const publish = makePublish(input.threadId, turnId);

        // ── Model Options ──────────────────────────────────────────────
        const modelSelection = input.modelSelection;
        const effort = getModelSelectionStringOptionValue(modelSelection, "effort");
        const thinking = getModelSelectionBooleanOptionValue(modelSelection, "thinking");

        // ── Tool Result Submission ──────────────────────────────────────
        // If the last assistant message has pending tool calls, submit tool results
        const lastMsg = ctx.messages.length > 0 ? ctx.messages[ctx.messages.length - 1] : null;
        if (lastMsg?.role === "assistant" && lastMsg.tool_calls) {
          for (const tc of lastMsg.tool_calls) {
            ctx.messages.push({
              role: "tool",
              tool_call_id: tc.id,
              content: input.input ?? "",
            });
          }
        }

        // ── Attachments ────────────────────────────────────────────────
        const attachments = input.attachments ?? [];
        if (attachments.length > 0) {
          const imageContents = yield* Effect.forEach(
            attachments,
            (att) =>
              Effect.gen(function* () {
                const resolvedPath = resolveAttachmentPath({
                  attachmentsDir: serverConfig.attachmentsDir,
                  attachment: att,
                });
                if (!resolvedPath) {
                  return yield* new ProviderAdapterRequestError({
                    provider: PROVIDER,
                    method: "chat/completions",
                    detail: `Invalid attachment id '${att.id}'.`,
                  });
                }
                const bytes = yield* fileSystem.readFile(resolvedPath).pipe(
                  Effect.mapError(
                    (cause) =>
                      new ProviderAdapterRequestError({
                        provider: PROVIDER,
                        method: "chat/completions",
                        detail: `Failed to read attachment file: ${cause.message}.`,
                        cause,
                      }),
                  ),
                );
                const base64 = Buffer.from(bytes).toString("base64");
                return {
                  type: "image_url" as const,
                  image_url: { url: `data:${att.mimeType};base64,${base64}` },
                } satisfies DeepSeekContentPart;
              }),
            { concurrency: 1 },
          );
          ctx.messages.push({
            role: "user",
            content: [
              ...(input.input ? [{ type: "text" as const, text: input.input }] : []),
              ...imageContents,
            ],
          });
        } else {
          ctx.messages.push({ role: "user", content: input.input ?? null });
        }

        const abortController = new AbortController();
        ctx.currentTurnAbort = abortController;

        yield* publish("turn.started", {
          model: resolveModel(settings),
        });
        yield* publish(
          "item.started",
          {
            itemType: "assistant_message",
            status: "inProgress",
          },
          undefined,
          assistantItemId,
        );

        yield* publish("thread.state.changed", { state: "active" });
        yield* publish("session.state.changed", { state: "running" });

        try {
          const body = buildRequestBody(settings, ctx.messages, effort, thinking);
          const response = yield* Effect.tryPromise({
            try: () => makeApiRequest(settings, options?.environment, body, abortController.signal),
            catch: (cause) =>
              new ProviderAdapterRequestError({
                provider: PROVIDER,
                method: "chat/completions",
                detail: `DeepSeek API request failed: ${String(cause)}`,
                cause,
              }),
          });

          if (!response.ok) {
            const errorText = yield* Effect.tryPromise(() => response.text());
            return yield* toAdapterError(response.status, errorText, "chat/completions");
          }

          if (!response.body) {
            return yield* new ProviderAdapterProcessError({
              provider: PROVIDER,
              detail: "DeepSeek API returned empty response body.",
            });
          }

          const reader = response.body.getReader();
          let assistantContent = "";
          let reasoningContent = "";
          const toolCallsAcc = new Map<number, { id: string; name: string; arguments: string }>();
          let lastUsage: DeepSeekStreamChunk["usage"] | undefined;
          let didFinalize = false;

          try {
            const chunks: DeepSeekStreamChunk[] = yield* Effect.tryPromise({
              try: async () => {
                const results: DeepSeekStreamChunk[] = [];
                for await (const chunk of parseSSEStream(reader)) {
                  results.push(chunk);
                }
                return results;
              },
              catch: (cause) =>
                new ProviderAdapterRequestError({
                  provider: PROVIDER,
                  method: "chat/completions",
                  detail: `DeepSeek SSE stream read failed: ${String(cause)}`,
                  cause,
                }),
            });

            for (const chunk of chunks) {
              const deltaToolCalls = chunk.choices?.[0]?.delta?.tool_calls;
              if (deltaToolCalls) {
                for (const tc of deltaToolCalls) {
                  const idx = tc.index ?? 0;
                  const existing = toolCallsAcc.get(idx);
                  if (tc.id) {
                    toolCallsAcc.set(idx, {
                      id: tc.id,
                      name: tc.function?.name ?? existing?.name ?? "",
                      arguments: tc.function?.arguments ?? existing?.arguments ?? "",
                    });
                  } else if (existing) {
                    existing.name = tc.function?.name ?? existing.name;
                    existing.arguments += tc.function?.arguments ?? "";
                  } else {
                    toolCallsAcc.set(idx, {
                      id: tc.id ?? "",
                      name: tc.function?.name ?? "",
                      arguments: tc.function?.arguments ?? "",
                    });
                  }
                }
              }

              const kind = streamKindForChunk(chunk);
              const text = chunkText(chunk);

              if (text && kind) {
                if (kind === "assistant_text") {
                  assistantContent += text;
                } else if (kind === "reasoning_text") {
                  reasoningContent += text;
                }

                yield* publish(
                  "content.delta",
                  {
                    streamKind: kind,
                    delta: text,
                  },
                  undefined,
                  assistantItemId,
                );
              }

              if (chunk.usage) {
                lastUsage = chunk.usage;
              }

              const finishReason = chunk.choices?.[0]?.finish_reason;
              if (finishReason) {
                if (finishReason === "tool_calls" && toolCallsAcc.size > 0) {
                  const toolCalls = Array.from(toolCallsAcc.values()).map((tc) => ({
                    id: tc.id,
                    type: "function" as const,
                    function: { name: tc.name, arguments: tc.arguments },
                  }));

                  for (const tc of toolCalls) {
                    const requestId = RuntimeRequestId.make(yield* nextUuid);
                    const approvalId = ApprovalRequestId.make(yield* nextUuid);

                    const deferred = Deferred.unsafeMake<ProviderApprovalDecision>();
                    ctx.pendingApproval.set(approvalId, {
                      decision: deferred,
                    });

                    yield* publish(
                      "request.opened",
                      {
                        requestType: "dynamic_tool_call",
                        detail: tc.function.name,
                        args: tc.function.arguments,
                      },
                      requestId,
                    );

                    Deferred.unsafeDone(deferred, Effect.succeed("accept"));
                    ctx.pendingApproval.delete(approvalId);

                    yield* publish(
                      "request.resolved",
                      {
                        requestType: "dynamic_tool_call",
                        decision: "accept",
                      },
                      requestId,
                    );
                  }

                  ctx.messages.push({
                    role: "assistant",
                    content: assistantContent || null,
                    tool_calls: toolCalls,
                  });
                } else {
                  ctx.messages.push({
                    role: "assistant",
                    content: assistantContent || null,
                  });
                }

                didFinalize = true;
                break;
              }
            }

            if (!didFinalize && assistantContent.length > 0) {
              ctx.messages.push({
                role: "assistant",
                content: assistantContent,
              });
            }
          } finally {
            reader.releaseLock();
          }

          // ── Token Usage ──────────────────────────────────────────────
          if (lastUsage) {
            const tokenUsage: ThreadTokenUsageSnapshot = {
              usedTokens: lastUsage.total_tokens,
              inputTokens: lastUsage.prompt_tokens,
              outputTokens: lastUsage.completion_tokens,
            };
            yield* publish("thread.token-usage.updated", {
              usage: tokenUsage,
            });
          }

          yield* publish(
            "item.completed",
            {
              itemType: "assistant_message",
              status: "completed",
            },
            undefined,
            assistantItemId,
          );

          yield* publish("turn.completed", {
            state: "completed",
            stopReason: "end_turn",
          });
        } catch (error) {
          if ((error as Error).name === "AbortError") {
            yield* publish("turn.completed", {
              state: "interrupted",
              stopReason: "cancelled",
            });
          } else {
            yield* publish("turn.completed", {
              state: "failed",
              stopReason: "error",
              errorMessage: String(error),
            });
            return yield* error;
          }
        } finally {
          ctx.currentTurnAbort = null;
          yield* publish("session.state.changed", { state: "ready" });
          yield* publish("thread.state.changed", { state: "idle" });
        }

        return { turnId };
      });

    // ── Interrupt Turn ─────────────────────────────────────────────────

    const interruptTurn: ProviderAdapterShape<ProviderAdapterError>["interruptTurn"] = (threadId) =>
      Effect.gen(function* () {
        const ctx = yield* requireSession(threadId);
        if (ctx.currentTurnAbort) {
          ctx.currentTurnAbort.abort();
          ctx.currentTurnAbort = null;
        }
        return yield* Effect.void;
      });

    // ── Respond to Request ─────────────────────────────────────────────

    const respondToRequest: ProviderAdapterShape<ProviderAdapterError>["respondToRequest"] = (
      threadId,
      requestId,
      decision,
    ) =>
      Effect.gen(function* () {
        const ctx = yield* requireSession(threadId);
        const pending = ctx.pendingApproval.get(requestId);
        if (!pending) {
          return yield* new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "respondToRequest",
            detail: `No pending approval found for request ${requestId}.`,
          });
        }
        yield* Effect.promise(() => Deferred.succeed(pending.decision, decision));
        ctx.pendingApproval.delete(requestId);
      });

    // ── Respond to User Input ──────────────────────────────────────────

    const respondToUserInput: ProviderAdapterShape<ProviderAdapterError>["respondToUserInput"] = (
      threadId,
      _requestId,
      answers,
    ) =>
      Effect.gen(function* () {
        const ctx = yield* requireSession(threadId);
        if (!ctx.pendingUserInput) {
          return yield* new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "respondToUserInput",
            detail: "No pending user input request.",
          });
        }
        yield* Effect.promise(() =>
          Deferred.succeed(ctx.pendingUserInput!.resolution, {
            _tag: "answered",
            answers,
          }),
        );
        ctx.pendingUserInput = null;
      });

    // ── Stop Session ───────────────────────────────────────────────────

    const stopSession: ProviderAdapterShape<ProviderAdapterError>["stopSession"] = (threadId) =>
      Effect.gen(function* () {
        const ctx = yield* requireSession(threadId);
        if (ctx.currentTurnAbort) {
          ctx.currentTurnAbort.abort();
          ctx.currentTurnAbort = null;
        }
        ctx.stopped = true;
        sessions.delete(threadId);
        const publish = makePublish(threadId);
        yield* publish("session.state.changed", { state: "stopped" });
      });

    // ── List / Has Session ─────────────────────────────────────────────

    const listSessions: ProviderAdapterShape<ProviderAdapterError>["listSessions"] = () =>
      Effect.sync(() =>
        Array.from(sessions.values())
          .filter((c) => !c.stopped)
          .map((c) => ({ ...c.session })),
      );

    const hasSession: ProviderAdapterShape<ProviderAdapterError>["hasSession"] = (threadId) =>
      Effect.sync(() => {
        const c = sessions.get(threadId);
        return c !== undefined && !c.stopped;
      });

    // ── Read Thread ────────────────────────────────────────────────────

    const readThread: ProviderAdapterShape<ProviderAdapterError>["readThread"] = (threadId) =>
      Effect.gen(function* () {
        const ctx = yield* requireSession(threadId);
        const turns = ctx.messages
          .filter((m) => m.role === "user" || m.role === "assistant")
          .map((m, idx) => ({
            id: TurnId.make(`turn-${idx}`),
            items: [{ role: m.role, content: m.content }],
          }));
        return {
          threadId,
          turns,
        };
      });

    // ── Rollback Thread ────────────────────────────────────────────────

    const rollbackThread: ProviderAdapterShape<ProviderAdapterError>["rollbackThread"] = (
      threadId,
      numTurns,
    ) =>
      Effect.gen(function* () {
        const ctx = yield* requireSession(threadId);
        if (!Number.isInteger(numTurns) || numTurns < 1) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "rollbackThread",
            issue: "numTurns must be an integer >= 1.",
          });
        }

        let removed = 0;
        while (removed < numTurns && ctx.messages.length > 0) {
          const last = ctx.messages[ctx.messages.length - 1];
          if (last.role === "user" || last.role === "assistant") {
            removed++;
          }
          ctx.messages.pop();
        }

        const turns = ctx.messages
          .filter((m) => m.role === "user" || m.role === "assistant")
          .map((m, idx) => ({
            id: TurnId.make(`turn-${idx}`),
            items: [{ role: m.role, content: m.content }],
          }));
        return { threadId, turns };
      });

    // ── Stop All ───────────────────────────────────────────────────────

    const stopAll: ProviderAdapterShape<ProviderAdapterError>["stopAll"] = () =>
      Effect.forEach(
        Array.from(sessions.keys()),
        (threadId) =>
          Effect.gen(function* () {
            const ctx = sessions.get(threadId);
            if (ctx?.currentTurnAbort) {
              ctx.currentTurnAbort.abort();
            }
            sessions.delete(threadId);
          }),
        { discard: true },
      );

    // ── Finalizer ──────────────────────────────────────────────────────

    yield* Effect.addFinalizer(() =>
      Effect.ignore(stopAll()).pipe(Effect.tap(() => PubSub.shutdown(runtimeEventPubSub))),
    );

    const streamEvents = Stream.fromPubSub(runtimeEventPubSub);

    return {
      provider: PROVIDER,
      capabilities: { sessionModelSwitch: "unsupported" },
      startSession,
      sendTurn,
      interruptTurn,
      readThread,
      rollbackThread,
      respondToRequest,
      respondToUserInput,
      stopSession,
      listSessions,
      hasSession,
      stopAll,
      streamEvents,
    };
  });
}
