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

const EXPECTED_URL_HINT =
  "Invalid GitHub PR URL. Expected: https://github.com/owner/repo/pull/123";

function stripUrlForParsing(raw: string): string {
  let s = raw.trim();
  s = s.replace(/#.*$/, "");
  s = s.replace(/\?.*$/, "");
  s = s.replace(/\/+$/, "");
  return s;
}

export function parsePRUrl(prUrl: string): {
  owner: string;
  repo: string;
  number: number;
} {
  const cleaned = stripUrlForParsing(prUrl);
  const lower = cleaned.toLowerCase();
  if (!lower.startsWith("https://github.com/")) {
    throw new Error(EXPECTED_URL_HINT);
  }

  const parts = cleaned.split("/");
  const owner = parts[3];
  const repo = parts[4];
  const pullSegment = parts[5];
  const numStr = parts[6];

  if (
    !owner ||
    !repo ||
    pullSegment?.toLowerCase() !== "pull" ||
    !numStr
  ) {
    throw new Error(EXPECTED_URL_HINT);
  }

  const trailing = parts.slice(7);
  if (trailing.length > 0) {
    const last = trailing[trailing.length - 1]?.toLowerCase();
    const allowedExtra =
      trailing.length === 1 && (last === "files" || last === "commits");
    if (!allowedExtra) {
      throw new Error(EXPECTED_URL_HINT);
    }
  }

  const number = Number.parseInt(numStr, 10);
  if (!Number.isInteger(number) || number < 1) {
    throw new Error(EXPECTED_URL_HINT);
  }

  return { owner, repo, number };
}

type GithubFileItem = {
  filename?: string;
  patch?: string;
  status?: string;
  additions?: number;
  deletions?: number;
};

function buildHeaders(): HeadersInit {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "pr-review-ai/1.0",
  };
  const token = process.env.GITHUB_TOKEN;
  if (typeof token === "string" && token.length > 0) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

function mapStatusToMessage(status: number): string | null {
  if (status === 404) {
    return "PR not found. Check the URL and ensure the repo is public.";
  }
  if (status === 401) {
    return "GitHub authentication failed. Check GITHUB_TOKEN or remove it to use public access.";
  }
  if (status === 403 || status === 429) {
    return "GitHub rate limit exceeded. Add a GITHUB_TOKEN to .env.local.";
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
  number: number,
): Promise<PullRequestFile[]> {
  const headers = buildHeaders();
  const base = `https://api.github.com/repos/${owner}/${repo}/pulls/${number}/files`;
  const all: GithubFileItem[] = [];
  let page = 1;

  for (;;) {
    const url = `${base}?per_page=100&page=${page}`;
    const res = await fetch(url, { headers, cache: "no-store" });

    const mapped = mapStatusToMessage(res.status);
    if (mapped) {
      throw new GitHubFetchError(mapped, res.status);
    }

    if (!res.ok) {
      throw new GitHubFetchError(`GitHub API error: HTTP ${res.status}`, res.status);
    }

    let data: unknown;
    try {
      data = await res.json();
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
  number: number,
): Promise<PullRequestFile[]> {
  const diffUrl = `https://github.com/${owner}/${repo}/pull/${number}.diff`;
  const res = await fetch(diffUrl, {
    headers: { "User-Agent": "pr-review-ai/1.0" },
    redirect: "follow",
    cache: "no-store",
  });

  if (!res.ok) {
    const mapped = mapStatusToMessage(res.status);
    throw new GitHubFetchError(
      mapped ?? `GitHub diff fetch error: HTTP ${res.status}`,
      res.status,
    );
  }

  const diffText = await res.text();
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
  const { owner, repo, number } = parsePRUrl(prUrl);

  try {
    return await fetchFilesFromApi(owner, repo, number);
  } catch (apiError) {
    if (!shouldTryDiffFallback(apiError)) {
      throw apiError;
    }

    try {
      const fallbackFiles = await fetchFilesFromDiffFallback(owner, repo, number);
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
