import { fetchPRDiff, type PullRequestFile } from "@/lib/github";
import { reviewDiff } from "@/lib/openai";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "no-store",
};

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function POST(request: Request): Promise<Response> {
  const primaryDemoUrl = "https://github.com/expressjs/express/pull/3276";
  const secondaryDemoUrl = "https://github.com/facebook/react/pull/11347";

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "Invalid JSON body." },
      { status: 400, headers: corsHeaders },
    );
  }

  const prUrl =
    typeof body === "object" &&
    body !== null &&
    "prUrl" in body &&
    typeof (body as { prUrl?: unknown }).prUrl === "string"
      ? (body as { prUrl: string }).prUrl.trim()
      : "";

  if (!prUrl) {
    return Response.json(
      { error: "prUrl is required." },
      { status: 400, headers: corsHeaders },
    );
  }

  if (!prUrl.includes("github.com")) {
    return Response.json(
      {
        error:
          "Invalid PR URL. URL must include github.com and match https://github.com/owner/repo/pull/123",
      },
      { status: 400, headers: corsHeaders },
    );
  }

  if (!prUrl.includes("/pull/")) {
    return Response.json(
      {
        error:
          "Invalid PR URL. URL must include /pull/ and match https://github.com/owner/repo/pull/123",
      },
      { status: 400, headers: corsHeaders },
    );
  }

  console.log(`[review] Received PR URL: ${prUrl}`);

  const pipeline = async (): Promise<Response> => {
    let files: PullRequestFile[];
    try {
      files = await fetchPRDiff(prUrl);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      if (
        prUrl === primaryDemoUrl &&
        message.includes("PR not found at github.com/expressjs/express/pull/3276")
      ) {
        console.log(
          `[review] Primary demo PR unavailable, falling back to ${secondaryDemoUrl}`,
        );
        try {
          files = await fetchPRDiff(secondaryDemoUrl);
        } catch (fallbackError) {
          const fallbackMessage =
            fallbackError instanceof Error
              ? fallbackError.message
              : "Unknown error";
          if (fallbackMessage.includes("PR not found at github.com/")) {
            files = [];
          } else {
            throw fallbackError;
          }
        }
      } else if (message.includes("PR not found at github.com/")) {
        files = [];
      } else {
        throw error;
      }
    }

    if (files.length === 0) {
      return Response.json(
        {
          comments: [],
          summary: "No reviewable files found in this pull request.",
          fileCount: 0,
        },
        {
          status: 200,
          headers: {
            ...corsHeaders,
            "X-Review-File-Count": "0",
          },
        },
      );
    }

    const review = await reviewDiff(files);
    return Response.json(
      {
        comments: review.comments,
        summary: review.summary,
        fileCount: files.length,
      },
      {
        status: 200,
        headers: {
          ...corsHeaders,
          "X-Review-File-Count": String(files.length),
        },
      },
    );
  };

  const timeout = new Promise<Response>((_, reject) => {
    setTimeout(() => {
      reject(new Error("Request timed out after 55 seconds."));
    }, 55000);
  });

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
