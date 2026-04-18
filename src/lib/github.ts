export interface PullRequestFile {
  filename: string;
  patch: string;
  status: string;
  additions: number;
  deletions: number;
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
  if (status === 403 || status === 429) {
    return "GitHub rate limit exceeded. Add a GITHUB_TOKEN to .env.local.";
  }
  if (status === 422) {
    return "Invalid PR number.";
  }
  return null;
}

export async function fetchPRDiff(prUrl: string): Promise<PullRequestFile[]> {
  const { owner, repo, number } = parsePRUrl(prUrl);
  const headers = buildHeaders();
  const base = `https://api.github.com/repos/${owner}/${repo}/pulls/${number}/files`;

  const all: GithubFileItem[] = [];
  let page = 1;

  for (;;) {
    const url = `${base}?per_page=100&page=${page}`;
    const res = await fetch(url, { headers, cache: "no-store" });

    const mapped = mapStatusToMessage(res.status);
    if (mapped) {
      throw new Error(mapped);
    }

    if (!res.ok) {
      throw new Error(`GitHub API error: HTTP ${res.status}`);
    }

    let data: unknown;
    try {
      data = await res.json();
    } catch {
      throw new Error("Unexpected GitHub API response format");
    }

    if (!Array.isArray(data)) {
      throw new Error("Unexpected GitHub API response format");
    }

    const batch = data as GithubFileItem[];
    all.push(...batch);

    if (batch.length < 100) {
      break;
    }
    page += 1;
  }

  const capped = all
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

  return capped;
}
