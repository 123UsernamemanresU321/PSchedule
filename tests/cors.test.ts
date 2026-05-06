import test from "node:test";
import assert from "node:assert/strict";
import { resolveAiCorsOrigin } from "../src/lib/ai/cors.ts";

test("resolveAiCorsOrigin allows LOCAL_DEV_ORIGINS", () => {
  assert.equal(resolveAiCorsOrigin("http://localhost:3000"), "http://localhost:3000");
  assert.equal(resolveAiCorsOrigin("http://127.0.0.1:3000"), "http://127.0.0.1:3000");
});

test("resolveAiCorsOrigin blocks arbitrary origins", () => {
  assert.equal(resolveAiCorsOrigin("https://evil.com"), null);
});

test("resolveAiCorsOrigin returns null for empty or null origin", () => {
  assert.equal(resolveAiCorsOrigin(null), null);
  assert.equal(resolveAiCorsOrigin(""), null);
  assert.equal(resolveAiCorsOrigin("   "), null);
});
