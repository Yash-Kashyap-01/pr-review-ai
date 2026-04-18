export interface PullRequestFile {
  filename: string;
  patch: string;
  status: string;
  additions: number;
  deletions: number;
}

type GithubFileItem = {
  filename?: string;
  patch?: string;
  status?: string;
  additions?: number;
  deletions?: number;
};

export function parsePRUrl(rawUrl: string): {
  owner: string;
  repo: string;
  number: number;
} {
  const expected =
    "Expected format: https://github.com/owner/repo/pull/123";

  if (typeof rawUrl !== "string") {
    throw new Error(`Invalid PR URL input. ${expected}`);
  }

  let cleaned = rawUrl.trim();
  if (!cleaned) {
    throw new Error(`PR URL is empty. ${expected}`);
  }

  cleaned = cleaned.replace(/\/+$/, "");
  cleaned = cleaned.split("?")[0] ?? cleaned;
  cleaned = cleaned.split("#")[0] ?? cleaned;
  cleaned = cleaned.replace(/\/(files|commits|checks|reviews|diffs)\/?$/i, "");

  if (!cleaned.includes("github.com")) {
    throw new Error(
      `URL must be a GitHub pull request URL that includes github.com. ${expected}`,
    );
  }

  const afterDomain = cleaned.split("github.com")[1];
  if (typeof afterDomain !== "string") {
    throw new Error(
      `Could not parse the path after github.com in "${rawUrl}". ${expected}`,
    );
  }

  const path = afterDomain.replace(/^\/+/, "");
  const parts = path.split("/").filter(Boolean);

  if (parts.length < 4) {
    throw new Error(
      `URL path is incomplete. Found "${path}". ${expected}`,
    );
  }

  const owner = parts[0];
  const repo = parts[1];
  const pullSegment = parts[2];
  const numberRaw = parts[3];

  if (!owner) {
    throw new Error(`Missing repository owner in URL. ${expected}`);
  }

  if (!repo) {
    throw new Error(`Missing repository name in URL. ${expected}`);
  }

  if (pullSegment !== "pull") {
    throw new Error(
      `URL must contain "/pull/" after owner/repo. Found "/${pullSegment}/". ${expected}`,
    );
  }

  const number = Number.parseInt(numberRaw, 10);
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(
      `Invalid pull request number "${numberRaw}". ${expected}`,
    );
  }

  return { owner, repo, number };
}

export function buildHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "pr-review-ai/1.0",
  };

  const token = process.env.GITHUB_TOKEN;
  const tokenIsUsable =
    typeof token === "string" &&
    token.length > 10 &&
    !token.startsWith("REPLACE");

  if (tokenIsUsable) {
    headers.Authorization = `Bearer ${token}`;
    console.log("[github] Using GITHUB_TOKEN for API requests");
  } else {
    console.log("[github] GITHUB_TOKEN missing/invalid; using unauthenticated requests");
  }

  return headers;
}

function normalizeFile(item: GithubFileItem): PullRequestFile {
  return {
    filename: typeof item.filename === "string" ? item.filename : "",
    patch: typeof item.patch === "string" ? item.patch : "",
    status: typeof item.status === "string" ? item.status : "modified",
    additions: typeof item.additions === "number" ? item.additions : 0,
    deletions: typeof item.deletions === "number" ? item.deletions : 0,
  };
}

export async function fetchPRDiff(prUrl: string): Promise<PullRequestFile[]> {
  const { owner, repo, number } = parsePRUrl(prUrl);
  console.log(`[github] Fetching PR files for ${owner}/${repo} #${number}`);

  let headers = buildHeaders();
  const token = process.env.GITHUB_TOKEN;
  const tokenSet =
    typeof token === "string" &&
    token.length > 10 &&
    !token.startsWith("REPLACE");

  const allFiles: PullRequestFile[] = [];
  let page = 1;
  let attemptedUnauthenticatedRetry = false;

  while (true) {
    const pageUrl = `https://api.github.com/repos/${owner}/${repo}/pulls/${number}/files?per_page=100&page=${page}`;

    let response: Response;
    try {
      response = await fetch(pageUrl, {
        method: "GET",
        headers,
        cache: "no-store",
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown network error";
      throw new Error(`Network error while fetching GitHub PR files: ${message}`);
    }

    const rateRemaining = response.headers.get("x-ratelimit-remaining") ?? "unknown";
    console.log(
      `[github] Page ${page} -> HTTP ${response.status}, rate remaining: ${rateRemaining}`,
    );

    if (
      response.status === 404 &&
      tokenSet &&
      !attemptedUnauthenticatedRetry
    ) {
      attemptedUnauthenticatedRetry = true;
      const retryHeaders = { ...headers };
      delete retryHeaders.Authorization;
      console.log(
        "[github] Received 404 with token; retrying once without Authorization header",
      );

      try {
        const retryResponse = await fetch(pageUrl, {
          method: "GET",
          headers: retryHeaders,
          cache: "no-store",
        });
        const retryRate =
          retryResponse.headers.get("x-ratelimit-remaining") ?? "unknown";
        console.log(
          `[github] Unauthenticated retry -> HTTP ${retryResponse.status}, rate remaining: ${retryRate}`,
        );
        response = retryResponse;
        if (retryResponse.ok) {
          headers = retryHeaders;
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown network error";
        throw new Error(
          `Network error while retrying GitHub request without token: ${message}`,
        );
      }
    }

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error(
          "GitHub authentication failed. Your GITHUB_TOKEN is invalid or expired. Generate a new one at github.com/settings/tokens and update it in Vercel Dashboard -> Settings -> Environment Variables.",
        );
      }

      if (response.status === 403 || response.status === 429) {
        throw new Error(
          `GitHub API rate limit exceeded. Token set on server: ${tokenSet}. Add a valid GITHUB_TOKEN in Vercel Dashboard -> Settings -> Environment Variables then redeploy.`,
        );
      }

      if (response.status === 404) {
        if (!tokenSet) {
          throw new Error(
            "GitHub returned 404. This is most likely a RATE LIMIT problem — no GITHUB_TOKEN is set on this server. Unauthenticated requests are limited to 60 per hour. Go to Vercel Dashboard -> Settings -> Environment Variables and add your GITHUB_TOKEN, then redeploy.",
          );
        }

        throw new Error(
          `PR not found at github.com/${owner}/${repo}/pull/${number}. Confirm the repository is public and this PR number exists.`,
        );
      }

      if (response.status === 422) {
        throw new Error(
          `Invalid PR. The pull request number ${number} does not exist in ${owner}/${repo}.`,
        );
      }

      throw new Error(
        `GitHub API returned HTTP ${response.status} for ${owner}/${repo}/pull/${number}`,
      );
    }

    const payload: unknown = await response.json();
    if (!Array.isArray(payload)) {
      throw new Error("GitHub API returned an unexpected response format for PR files.");
    }

    const pageFiles = payload as GithubFileItem[];
    const validPageFiles = pageFiles
      .filter((file) => file.status !== "removed")
      .filter(
        (file) =>
          typeof file.patch === "string" && file.patch.trim().length > 0,
      )
      .map(normalizeFile);

    allFiles.push(...validPageFiles);

    if (pageFiles.length < 100) {
      break;
    }

    page += 1;
    if (page > 10) {
      break;
    }
  }

  const cappedFiles = allFiles.slice(0, 50);
  console.log(
    `[github] Total reviewable files: ${allFiles.length}, after cap: ${cappedFiles.length}`,
  );
  return cappedFiles;
}
