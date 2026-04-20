import { NextRequest, NextResponse } from "next/server";
import { buildCorsResponse } from "../_shared";
import { buildAiCorsHeaders, resolveAiCorsOrigin } from "../../../../lib/ai/cors";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const requestOrigin = req.headers.get("origin");
  const allowedOrigin = resolveAiCorsOrigin(requestOrigin);
  const corsHeaders = buildAiCorsHeaders(allowedOrigin);

  return NextResponse.json(
    {
      ok: true,
      configured:
        !!(process.env.DEEPSEEK_API_KEY ?? "").trim() &&
        !!(process.env.AI_ACCESS_PASSWORD ?? "").trim() &&
        !!(process.env.AI_SESSION_SECRET ?? "").trim(),
      provider: "deepseek",
      backendUrl: null,
      fastModel: (process.env.DEEPSEEK_MODEL_FAST ?? "deepseek-chat").trim(),
      reviewModel: (process.env.DEEPSEEK_MODEL_REVIEW ?? "deepseek-reasoner").trim(),
    },
    {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json; charset=utf-8",
      },
    },
  );
}

export async function OPTIONS(req: NextRequest) {
  return buildCorsResponse(req);
}
