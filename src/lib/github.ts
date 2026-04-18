export interface PullRequestFile {
  filename: string;
  patch: string;
  status: string;
  additions: number;
  deletions: number;
}

class GitHubFetchError extends Error {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "GitHubFetchError";
    this.status = status;
  }
}

export function parsePRUrl(
  prUrl: string,
): { owner: string; repo: string; number: number } {
  try {
    const cleaned = prUrl.trim();
    const withoutSlash = cleaned.replace(/\/$/, "");
    const withoutQuery = withoutSlash.split("?")[0].split("#")[0];
    const withoutSuffix = withoutQuery.replace(
      /\/(files|commits|checks|reviews)$/,
      "",
    );

    let pathname: string;
    try {
      const url = new URL(withoutSuffix);
      if (!url.hostname.includes("github.com")) {
        throw new Error("Not a GitHub URL");
      }
      pathname = url.pathname;
    } catch {
      if (withoutSuffix.includes("github.com")) {
        pathname = withoutSuffix.split("github.com")[1];
      } else {
        throw new Error("Invalid GitHub URL");
      }
    }

    const parts = pathname.replace(/^\//, "").split("/");
    if (parts.length < 4) {
      throw new Error("URL too short");
    }

    const owner = parts[0];
    const repo = parts[1];
    const pullWord = parts[2];
    const numberStr = parts[3];

    if (!owner || !repo) {
      throw new Error("Missing owner or repo");
    }

    if (pullWord !== "pull") {
      throw new Error("Not a pull request URL — must contain /pull/");
    }

    const number = parseInt(numberStr, 10);
    if (isNaN(number) || number <= 0) {
      throw new Error("Invalid PR number");
    }

    return { owner, repo, number };
  } catch (err) {
    throw new Error(
      `Invalid GitHub PR URL. Expected format: https://github.com/owner/repo/pull/123. ` +
        `Got: "${prUrl}". ` +
        (err instanceof Error ? `Reason: ${err.message}` : ""),
    );
  }
}

type GithubFileItem = {
  filename?: string;
  patch?: string;
  status?: string;
  additions?: number;
  deletions?: number;
};

function buildHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "pr-review-ai/1.0",
  };
  const token = process.env.GITHUB_TOKEN;
  if (token && token.length > 10 && !token.includes("REPLACE")) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

function mapStatusToMessage(
  status: number,
  owner: string,
  repo: string,
  prNumber: number,
): string | null {
  if (status === 404) {
    return (
      `PR not found: github.com/${owner}/${repo}/pull/${prNumber}. ` +
      "Make sure the repository is public and the PR number exists."
    );
  }
  if (status === 401) {
    return "GitHub authentication failed. Check GITHUB_TOKEN or remove it to use public access.";
  }
  if (status === 403 || status === 429) {
    return (
      "GitHub rate limit hit. The app needs a GITHUB_TOKEN environment variable. " +
      "Add it in your Vercel dashboard under Settings → Environment Variables."
    );
  }
  if (status === 422) {
    return "Invalid PR number.";
  }
  return null;
}

function finalizeFiles(all: GithubFileItem[]): PullRequestFile[] {
  return all
    .filter((f) => f.status !== "removed")
    .filter((f) => typeof f.patch === "string" && f.patch.length > 0)
    .slice(0, 50)
    .map((f): PullRequestFile => ({
      filename: String(f.filename ?? ""),
      patch: String(f.patch ?? ""),
      status: String(f.status ?? ""),
      additions: typeof f.additions === "number" ? f.additions : 0,
      deletions: typeof f.deletions === "number" ? f.deletions : 0,
    }));
}

async function fetchFilesFromApi(
  owner: string,
  repo: string,
  prNumber: number,
): Promise<PullRequestFile[]> {
  const headers = buildHeaders();
  const base = `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/files`;
  const all: GithubFileItem[] = [];
  let page = 1;

  for (;;) {
    const url = `${base}?per_page=100&page=${page}`;
    console.log(
      `[github] Fetching page ${page} for ${owner}/${repo}/pulls/${prNumber}`,
    );
    const response = await fetch(url, { headers, cache: "no-store" });
    console.log(`[github] Response status: ${response.status}`);

    const mapped = mapStatusToMessage(response.status, owner, repo, prNumber);
    if (mapped) {
      throw new GitHubFetchError(mapped, response.status);
    }

    if (!response.ok) {
      throw new GitHubFetchError(
        `GitHub API error: HTTP ${response.status}`,
        response.status,
      );
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch {
      throw new GitHubFetchError("Unexpected GitHub API response format");
    }

    if (!Array.isArray(data)) {
      throw new GitHubFetchError("Unexpected GitHub API response format");
    }

    const batch = data as GithubFileItem[];
    all.push(...batch);

    if (batch.length < 100) {
      break;
    }
    page += 1;
  }

  return finalizeFiles(all);
}

function normalizeDiffPath(rawPath: string | undefined): string {
  if (!rawPath) return "";
  const trimmed = rawPath.trim().replace(/^"+|"+$/g, "");
  if (trimmed.startsWith("a/") || trimmed.startsWith("b/")) {
    return trimmed.slice(2);
  }
  return trimmed;
}

function parseDiffBlock(block: string): GithubFileItem | null {
  const lines = block.split("\n");
  const renameTo = lines.find((line) => line.startsWith("rename to "));
  const newPathLine = lines.find(
    (line) => line.startsWith("+++ ") && line !== "+++ /dev/null",
  );
  const oldPathLine = lines.find(
    (line) => line.startsWith("--- ") && line !== "--- /dev/null",
  );

  const filename =
    normalizeDiffPath(renameTo?.slice("rename to ".length)) ||
    normalizeDiffPath(newPathLine?.slice(4)) ||
    normalizeDiffPath(oldPathLine?.slice(4));

  if (!filename) {
    return null;
  }

  const hunkIndex = lines.findIndex((line) => line.startsWith("@@"));
  if (hunkIndex === -1) {
    return null;
  }

  const patchLines = lines.slice(hunkIndex);
  let additions = 0;
  let deletions = 0;

  for (const line of patchLines) {
    if (line.startsWith("+") && !line.startsWith("+++")) {
      additions += 1;
      continue;
    }
    if (line.startsWith("-") && !line.startsWith("---")) {
      deletions += 1;
    }
  }

  const isAdded = lines.includes("--- /dev/null");
  const isRemoved = lines.includes("+++ /dev/null");
  const isRenamed = lines.some((line) => line.startsWith("rename from "));

  return {
    filename,
    patch: patchLines.join("\n").trim(),
    status: isRemoved ? "removed" : isAdded ? "added" : isRenamed ? "renamed" : "modified",
    additions,
    deletions,
  };
}

function parseUnifiedDiff(diffText: string): PullRequestFile[] {
  const normalized = diffText.replace(/\r\n/g, "\n");
  const blocks = normalized
    .split(/^diff --git /m)
    .filter((block) => block.trim().length > 0)
    .map((block) => `diff --git ${block.trimEnd()}`);

  const parsed = blocks
    .map((block) => parseDiffBlock(block))
    .filter((item): item is GithubFileItem => item !== null);

  return finalizeFiles(parsed);
}

async function fetchFilesFromDiffFallback(
  owner: string,
  repo: string,
  prNumber: number,
): Promise<PullRequestFile[]> {
  const diffUrl = `https://github.com/${owner}/${repo}/pull/${prNumber}.diff`;
  console.log(
    `[github] Fetching page 1 for ${owner}/${repo}/pulls/${prNumber}`,
  );
  const response = await fetch(diffUrl, {
    headers: { "User-Agent": "pr-review-ai/1.0" },
    redirect: "follow",
    cache: "no-store",
  });
  console.log(`[github] Response status: ${response.status}`);

  if (!response.ok) {
    const mapped = mapStatusToMessage(response.status, owner, repo, prNumber);
    throw new GitHubFetchError(
      mapped ?? `GitHub diff fetch error: HTTP ${response.status}`,
      response.status,
    );
  }

  const diffText = await response.text();
  if (!diffText.includes("diff --git ")) {
    throw new GitHubFetchError("Unexpected GitHub diff response format");
  }

  return parseUnifiedDiff(diffText);
}

function shouldTryDiffFallback(error: unknown): boolean {
  if (!(error instanceof GitHubFetchError)) {
    return true;
  }
  if (error.status === 422) {
    return false;
  }
  return true;
}

export async function fetchPRDiff(prUrl: string): Promise<PullRequestFile[]> {
  const { owner, repo, number: prNumber } = parsePRUrl(prUrl);

  try {
    return await fetchFilesFromApi(owner, repo, prNumber);
  } catch (apiError) {
    if (!shouldTryDiffFallback(apiError)) {
      throw apiError;
    }

    try {
      const fallbackFiles = await fetchFilesFromDiffFallback(
        owner,
        repo,
        prNumber,
      );
      if (fallbackFiles.length > 0) {
        return fallbackFiles;
      }
    } catch (fallbackError) {
      if (!(apiError instanceof Error)) {
        throw fallbackError;
      }
    }

    if (apiError instanceof Error) {
      throw apiError;
    }

    throw new Error("Failed to fetch PR diff");
  }
}
