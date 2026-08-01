import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  type DeepSeekSettings,
  type ModelSelection,
  TextGenerationError,
} from "@t3tools/contracts";
import { sanitizeBranchFragment, sanitizeFeatureBranchName } from "@t3tools/shared/git";
import { extractJsonObject } from "@t3tools/shared/schemaJson";

import * as TextGeneration from "./TextGeneration.ts";
import {
  buildBranchNamePrompt,
  buildCommitMessagePrompt,
  buildPrContentPrompt,
  buildThreadTitlePrompt,
} from "./TextGenerationPrompts.ts";
import {
  sanitizeCommitSubject,
  sanitizePrTitle,
  sanitizeThreadTitle,
} from "./TextGenerationUtils.ts";

const DEEPSEEK_TIMEOUT_MS = 120_000;

function resolveApiKey(settings: DeepSeekSettings, environment: NodeJS.ProcessEnv): string {
  return settings.apiKey || environment.DEEPSEEK_API_KEY || "";
}

function resolveBaseUrl(settings: DeepSeekSettings): string {
  return settings.baseUrl || "https://api.deepseek.com";
}

function resolveModel(settings: DeepSeekSettings, modelSelection: ModelSelection): string {
  return modelSelection.model || settings.model || "deepseek-v4-flash";
}

interface DeepSeekJsonResponse<T> {
  readonly result: T;
}

export const makeDeepSeekTextGeneration = Effect.fn("makeDeepSeekTextGeneration")(function* (
  deepSeekSettings: DeepSeekSettings,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const crypto = yield* Crypto.Crypto;

  const callDeepSeekApi = <S extends Schema.Top>({
    operation,
    prompt,
    outputSchemaJson,
    modelSelection,
  }: {
    operation:
      | "generateCommitMessage"
      | "generatePrContent"
      | "generateBranchName"
      | "generateThreadTitle";
    prompt: string;
    outputSchemaJson: S;
    modelSelection: ModelSelection;
  }): Effect.Effect<S["Type"], TextGenerationError, S["DecodingServices"]> =>
    Effect.gen(function* () {
      const apiKey = resolveApiKey(deepSeekSettings, environment);
      if (!apiKey) {
        return yield* new TextGenerationError({
          operation,
          detail: "DeepSeek API key not configured.",
        });
      }

      const baseUrl = resolveBaseUrl(deepSeekSettings);
      const model = resolveModel(deepSeekSettings, modelSelection);

      const body = {
        model,
        messages: [
          { role: "system", content: prompt },
          {
            role: "user",
            content: "Generate the structured output following the requested format exactly.",
          },
        ],
        stream: false,
        response_format: { type: "json_object" },
      };

      const response = yield* Effect.tryPromise({
        try: () =>
          fetch(`${baseUrl}/chat/completions`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(DEEPSEEK_TIMEOUT_MS),
          }),
        catch: (cause) =>
          new TextGenerationError({
            operation,
            detail: `DeepSeek API request failed: ${String(cause)}`,
            cause,
          }),
      });

      if (!response.ok) {
        const errorText = yield* Effect.tryPromise(() => response.text());
        return yield* new TextGenerationError({
          operation,
          detail: `DeepSeek API returned ${response.status}: ${errorText}`,
        });
      }

      const data = yield* Effect.tryPromise(() => response.json());
      const content = (data as any)?.choices?.[0]?.message?.content;

      if (!content || typeof content !== "string" || content.trim().length === 0) {
        return yield* new TextGenerationError({
          operation,
          detail: "DeepSeek API returned empty output.",
        });
      }

      const trimmed = content.trim();
      const decodeOutput = Schema.decodeEffect(Schema.fromJsonString(outputSchemaJson));
      return yield* decodeOutput(extractJsonObject(trimmed)).pipe(
        Effect.catchTags({
          SchemaError: (cause) =>
            Effect.fail(
              new TextGenerationError({
                operation,
                detail: "DeepSeek returned invalid structured output.",
                cause,
              }),
            ),
        }),
      );
    }).pipe(
      Effect.mapError((cause) =>
        cause instanceof TextGenerationError
          ? cause
          : new TextGenerationError({
              operation,
              detail: "DeepSeek text generation failed.",
              cause,
            }),
      ),
    );

  const generateCommitMessage: TextGeneration.TextGeneration["Service"]["generateCommitMessage"] =
    Effect.fn("DeepSeekTextGeneration.generateCommitMessage")(function* (input) {
      const { prompt, outputSchema } = buildCommitMessagePrompt({
        branch: input.branch,
        stagedSummary: input.stagedSummary,
        stagedPatch: input.stagedPatch,
        includeBranch: input.includeBranch === true,
        policy: input.policy,
      });

      const generated = yield* callDeepSeekApi({
        operation: "generateCommitMessage",
        prompt,
        outputSchemaJson: outputSchema,
        modelSelection: input.modelSelection,
      });

      return {
        subject: sanitizeCommitSubject(generated.subject),
        body: generated.body.trim(),
        ...("branch" in generated && typeof generated.branch === "string"
          ? { branch: sanitizeFeatureBranchName(generated.branch) }
          : {}),
      };
    });

  const generatePrContent: TextGeneration.TextGeneration["Service"]["generatePrContent"] =
    Effect.fn("DeepSeekTextGeneration.generatePrContent")(function* (input) {
      const { prompt, outputSchema } = buildPrContentPrompt({
        baseBranch: input.baseBranch,
        headBranch: input.headBranch,
        commitSummary: input.commitSummary,
        diffSummary: input.diffSummary,
        diffPatch: input.diffPatch,
        policy: input.policy,
        changeRequestTemplate: input.changeRequestTemplate,
      });

      const generated = yield* callDeepSeekApi({
        operation: "generatePrContent",
        prompt,
        outputSchemaJson: outputSchema,
        modelSelection: input.modelSelection,
      });

      return {
        title: sanitizePrTitle(generated.title),
        body: generated.body.trim(),
      };
    });

  const generateBranchName: TextGeneration.TextGeneration["Service"]["generateBranchName"] =
    Effect.fn("DeepSeekTextGeneration.generateBranchName")(function* (input) {
      const { prompt, outputSchema } = buildBranchNamePrompt({
        message: input.message,
        attachments: input.attachments,
      });

      const generated = yield* callDeepSeekApi({
        operation: "generateBranchName",
        prompt,
        outputSchemaJson: outputSchema,
        modelSelection: input.modelSelection,
      });

      return {
        branch: sanitizeBranchFragment(generated.branch),
      };
    });

  const generateThreadTitle: TextGeneration.TextGeneration["Service"]["generateThreadTitle"] =
    Effect.fn("DeepSeekTextGeneration.generateThreadTitle")(function* (input) {
      const { prompt, outputSchema } = buildThreadTitlePrompt({
        message: input.message,
        attachments: input.attachments,
      });

      const generated = yield* callDeepSeekApi({
        operation: "generateThreadTitle",
        prompt,
        outputSchemaJson: outputSchema,
        modelSelection: input.modelSelection,
      });

      return {
        title: sanitizeThreadTitle(generated.title),
      } satisfies TextGeneration.ThreadTitleGenerationResult;
    });

  return {
    generateCommitMessage,
    generatePrContent,
    generateBranchName,
    generateThreadTitle,
  } satisfies TextGeneration.TextGeneration["Service"];
});
