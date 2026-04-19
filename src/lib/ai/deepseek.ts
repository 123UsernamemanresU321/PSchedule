import { z } from "zod";

import { assertAiRuntimeConfig } from "@/lib/ai/auth";

const deepSeekResponseSchema = z.object({
  choices: z.array(
    z.object({
      message: z.object({
        content: z.string().nullable().optional(),
      }),
    }),
  ),
});

function extractJson(content: string) {
  try {
    return JSON.parse(content);
  } catch {
    const firstBrace = content.indexOf("{");
    const lastBrace = content.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      return JSON.parse(content.slice(firstBrace, lastBrace + 1));
    }
    throw new Error("DeepSeek did not return valid json content.");
  }
}

export async function callDeepSeekJson<T>(options: {
  model: string;
  schema: z.ZodType<T>;
  system: string;
  user: string;
  temperature?: number;
}) {
  const config = assertAiRuntimeConfig();
  const response = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: options.model,
      temperature: options.temperature ?? 0.2,
      response_format: {
        type: "json_object",
      },
      messages: [
        {
          role: "system",
          content: options.system,
        },
        {
          role: "user",
          content: options.user,
        },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`DeepSeek request failed (${response.status}): ${body}`);
  }

  const parsedResponse = deepSeekResponseSchema.parse(await response.json());
  const content = parsedResponse.choices[0]?.message.content;

  if (!content) {
    throw new Error("DeepSeek returned an empty response body.");
  }

  return options.schema.parse(extractJson(content));
}
