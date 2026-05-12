import test from "node:test";
import assert from "node:assert/strict";
import { resolveAiCorsOrigin } from "@/lib/ai/cors";

test("resolveAiCorsOrigin allows the configured AI_ALLOWED_ORIGIN", () => {
  const previous = process.env.AI_ALLOWED_ORIGIN;
  process.env.AI_ALLOWED_ORIGIN = "https://123usernamemanresu321.github.io";

  try {
    assert.equal(
      resolveAiCorsOrigin("https://123usernamemanresu321.github.io"),
      "https://123usernamemanresu321.github.io",
    );
  } finally {
    if (previous == null) {
      delete process.env.AI_ALLOWED_ORIGIN;
    } else {
      process.env.AI_ALLOWED_ORIGIN = previous;
    }
  }
});

test("resolveAiCorsOrigin normalizes configured origins with quotes and trailing slashes", () => {
  const previous = process.env.AI_ALLOWED_ORIGIN;
  process.env.AI_ALLOWED_ORIGIN = "'https://123usernamemanresu321.github.io/'";

  try {
    assert.equal(
      resolveAiCorsOrigin("https://123usernamemanresu321.github.io"),
      "https://123usernamemanresu321.github.io",
    );
  } finally {
    if (previous == null) {
      delete process.env.AI_ALLOWED_ORIGIN;
    } else {
      process.env.AI_ALLOWED_ORIGIN = previous;
    }
  }
});

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
