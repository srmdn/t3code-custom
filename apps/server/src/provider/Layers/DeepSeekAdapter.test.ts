import * as NodeAssert from "node:assert/strict";
import { it } from "@effect/vitest";

import { buildRequestBody, checkModelMismatch, extractResponseModel } from "./DeepSeekAdapter.ts";

type DeepSeekStreamChunk = Parameters<typeof extractResponseModel>[0][number];

const makeSseChunk = (overrides: Partial<DeepSeekStreamChunk> = {}): DeepSeekStreamChunk => ({
  ...overrides,
});

// ── Request body helpers ──────────────────────────────────────────────

it("Flash + effort low + thinking enabled sends deepseek-v4-flash with low/enabled", () => {
  const body = buildRequestBody("deepseek-v4-flash", [], "low", true);

  NodeAssert.equal(body.model, "deepseek-v4-flash");
  NodeAssert.equal(body.reasoning_effort, "low");
  NodeAssert.deepEqual(body.thinking, { type: "enabled" });
  NodeAssert.equal(body.stream, true);
  NodeAssert.deepEqual(body.stream_options, { include_usage: true });
});

it("Flash + effort max + thinking enabled sends deepseek-v4-flash with max/enabled", () => {
  const body = buildRequestBody("deepseek-v4-flash", [], "max", true);

  NodeAssert.equal(body.model, "deepseek-v4-flash");
  NodeAssert.equal(body.reasoning_effort, "max");
  NodeAssert.deepEqual(body.thinking, { type: "enabled" });
  NodeAssert.equal(body.stream, true);
});

it("Pro + effort high + thinking disabled sends deepseek-v4-pro with high/disabled", () => {
  const body = buildRequestBody("deepseek-v4-pro", [], "high", false);

  NodeAssert.equal(body.model, "deepseek-v4-pro");
  NodeAssert.equal(body.reasoning_effort, "high");
  NodeAssert.deepEqual(body.thinking, { type: "disabled" });
  NodeAssert.equal(body.stream, true);
});

it("omits reasoning_effort when effort is not provided", () => {
  const body = buildRequestBody("deepseek-v4-pro", [], undefined, true);

  NodeAssert.equal(body.model, "deepseek-v4-pro");
  NodeAssert.equal("reasoning_effort" in body, false);
  NodeAssert.deepEqual(body.thinking, { type: "enabled" });
});

it("omits thinking when thinking is undefined", () => {
  const body = buildRequestBody("deepseek-v4-pro", [], "low", undefined);

  NodeAssert.equal(body.model, "deepseek-v4-pro");
  NodeAssert.equal(body.reasoning_effort, "low");
  NodeAssert.equal("thinking" in body, false);
});

// ── Response model extraction ─────────────────────────────────────────

it("extractResponseModel returns model from first chunk that has it", () => {
  const chunks: DeepSeekStreamChunk[] = [
    makeSseChunk({ id: "chunk-1" }),
    makeSseChunk({ model: "deepseek-v4-flash", id: "chunk-2" }),
    makeSseChunk({ model: "deepseek-v4-pro", id: "chunk-3" }),
  ];

  const model = extractResponseModel(chunks);
  NodeAssert.equal(model, "deepseek-v4-flash");
});

it("extractResponseModel returns first non-empty model", () => {
  const chunks: DeepSeekStreamChunk[] = [
    makeSseChunk({ id: "chunk-1" }),
    makeSseChunk({ model: "", id: "chunk-2" }),
    makeSseChunk({ model: "deepseek-v4-pro", id: "chunk-3" }),
  ];

  const model = extractResponseModel(chunks);
  NodeAssert.equal(model, "deepseek-v4-pro");
});

it("extractResponseModel returns undefined when no chunk has a model", () => {
  const chunks: DeepSeekStreamChunk[] = [
    makeSseChunk({ id: "chunk-1" }),
    makeSseChunk({ id: "chunk-2" }),
  ];

  const model = extractResponseModel(chunks);
  NodeAssert.equal(model, undefined);
});

it("extractResponseModel returns undefined for empty chunks array", () => {
  const model = extractResponseModel([]);
  NodeAssert.equal(model, undefined);
});

// ── Model mismatch detection ──────────────────────────────────────────

it("checkModelMismatch returns null when response model matches requested model", () => {
  const chunks: DeepSeekStreamChunk[] = [
    makeSseChunk({ id: "chunk-1" }),
    makeSseChunk({ model: "deepseek-v4-flash", id: "chunk-2" }),
  ];

  const mismatch = checkModelMismatch(chunks, "deepseek-v4-flash");
  NodeAssert.equal(mismatch, null);
});

it("checkModelMismatch returns response model when it differs from requested model", () => {
  const chunks: DeepSeekStreamChunk[] = [
    makeSseChunk({ id: "chunk-1" }),
    makeSseChunk({ model: "deepseek-v4-pro", id: "chunk-2" }),
  ];

  const mismatch = checkModelMismatch(chunks, "deepseek-v4-flash");
  NodeAssert.equal(mismatch, "deepseek-v4-pro");
});

it("checkModelMismatch returns null when no model in chunks", () => {
  const chunks: DeepSeekStreamChunk[] = [makeSseChunk({ id: "chunk-1" })];

  const mismatch = checkModelMismatch(chunks, "deepseek-v4-flash");
  NodeAssert.equal(mismatch, null);
});

it("checkModelMismatch returns mismatch when chunk model differs (Pro vs Flash)", () => {
  const chunks: DeepSeekStreamChunk[] = [makeSseChunk({ model: "deepseek-v4-pro", id: "chunk-1" })];

  const mismatch = checkModelMismatch(chunks, "deepseek-v4-flash");
  NodeAssert.equal(mismatch, "deepseek-v4-pro");
});
