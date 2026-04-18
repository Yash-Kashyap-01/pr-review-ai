import { buildHeaders } from "@/lib/github";

type DebugResponse = {
  status: "ok";
  timestamp: string;
  environment: string | undefined;
  openai: {
    key_set: boolean;
    key_valid_format: boolean;
    key_preview: string;
  };
  github: {
    token_set: boolean;
    token_preview: string;
    api_status: string;
    rate_limit_remaining: string;
    rate_limit_total: string;
  };
};

export async function GET(): Promise<Response> {
  const openaiKey = process.env.OPENAI_API_KEY;
  const githubToken = process.env.GITHUB_TOKEN;

  const openaiSet = typeof openaiKey === "string" && openaiKey.length > 0;
  const githubSet = typeof githubToken === "string" && githubToken.length > 0;

  let githubApiStatus = "ERROR: Unknown";
  let rateLimitRemaining = "unknown";
  let rateLimitTotal = "unknown";

  try {
    const response = await fetch("https://api.github.com/rate_limit", {
      method: "GET",
      headers: buildHeaders(),
      cache: "no-store",
    });

    if (response.ok) {
      githubApiStatus = "REACHABLE";
    } else {
      githubApiStatus = `HTTP ${response.status}`;
    }

    rateLimitRemaining =
      response.headers.get("x-ratelimit-remaining") ?? "unknown";
    rateLimitTotal = response.headers.get("x-ratelimit-limit") ?? "unknown";
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    githubApiStatus = `ERROR: ${message}`;
  }

  const result: DebugResponse = {
    status: "ok",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
    openai: {
      key_set: openaiSet,
      key_valid_format: typeof openaiKey === "string" && openaiKey.startsWith("sk-"),
      key_preview:
        typeof openaiKey === "string" && openaiKey.length >= 7
          ? `${openaiKey.slice(0, 7)}***`
          : "NOT SET",
    },
    github: {
      token_set: githubSet,
      token_preview:
        typeof githubToken === "string" && githubToken.length >= 8
          ? `${githubToken.slice(0, 8)}***`
          : "NOT SET",
      api_status: githubApiStatus,
      rate_limit_remaining: rateLimitRemaining,
      rate_limit_total: rateLimitTotal,
    },
  };

  return Response.json(result, {
    status: 200,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
