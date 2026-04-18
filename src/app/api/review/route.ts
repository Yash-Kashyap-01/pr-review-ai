import { fetchPRDiff } from "@/lib/github";
import { reviewDiff } from "@/lib/openai";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
};

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function POST(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  let prUrl: string | undefined;
  try {
    const body: unknown = await request.json();
    prUrl =
      typeof body === "object" &&
      body !== null &&
      "prUrl" in body &&
      typeof (body as { prUrl: unknown }).prUrl === "string"
        ? (body as { prUrl: string }).prUrl
        : undefined;
  } catch {
    return Response.json(
      { error: "Invalid JSON body" },
      { status: 400, headers: corsHeaders },
    );
  }

  if (!prUrl) {
    return Response.json(
      { error: "prUrl is required" },
      { status: 400, headers: corsHeaders },
    );
  }

  const pipeline = async () => {
    const files = await fetchPRDiff(prUrl);
    if (files.length === 0) {
      return Response.json(
        {
          comments: [],
          summary:
            "No reviewable changes found (all files may be binary or deleted).",
          fileCount: 0,
        },
        { headers: corsHeaders },
      );
    }
    const result = await reviewDiff(files);
    return Response.json(
      { ...result, fileCount: files.length },
      {
        headers: {
          ...corsHeaders,
          "X-Review-File-Count": String(files.length),
        },
      },
    );
  };

  const timeout = new Promise<Response>((_, reject) =>
    setTimeout(
      () =>
        reject(
          new Error("Request timeout: PR is too large. Try a smaller PR."),
        ),
      55000,
    ),
  );

  try {
    return await Promise.race([pipeline(), timeout]);
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 400, headers: corsHeaders },
    );
  }
}
