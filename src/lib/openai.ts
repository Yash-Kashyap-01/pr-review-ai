import OpenAI from "openai";
import type { PullRequestFile } from "./github";

export interface ReviewComment {
  file: string;
  line: number;
  severity: "critical" | "warning" | "suggestion";
  issue: string;
  fix: string;
}

export interface ReviewResult {
  comments: ReviewComment[];
  summary: string;
}

const SYSTEM_PROMPT = `You are an expert senior software engineer conducting a thorough code review.
You have deep expertise in security, performance, maintainability, and best practices
across all major programming languages.

Analyze the provided git diff and identify ALL of the following:
- Security vulnerabilities (SQL injection, XSS, CSRF, insecure dependencies, exposed secrets, auth flaws)
- Performance issues (N+1 queries, memory leaks, unnecessary re-renders, blocking operations)
- Code quality problems (missing error handling, dead code, poor naming, missing types)
- Best practice violations (deprecated patterns, improper API usage)

Severity levels:
- "critical": Security bugs or crashes in production
- "warning": Performance or maintainability issues that should be fixed before shipping
- "suggestion": Improvements that would make the code cleaner

RESPOND WITH ONLY A VALID JSON OBJECT — no markdown, no code fences, no explanation.
Schema:
{
  "comments": [
    { "file": "path/to/file", "line": 42, "severity": "critical", "issue": "...", "fix": "..." }
  ],
  "summary": "2-3 sentence overall assessment"
}
If no issues found: { "comments": [], "summary": "This PR looks clean." }`;

const SEVERITIES = new Set<string>(["critical", "warning", "suggestion"]);

function formatDiffForPrompt(files: PullRequestFile[]): string {
  return files
    .map((f) => `=== FILE: ${f.filename} ===\n${f.patch}\n`)
    .join("");
}

function chunkDiff(diffText: string, maxChars = 60000): string[] {
  if (diffText.length <= maxChars) return [diffText];
  const chunks: string[] = [];
  for (let i = 0; i < diffText.length; i += maxChars) {
    chunks.push(diffText.slice(i, i + maxChars));
  }
  return chunks;
}

function tryParseJson(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function stripCodeFences(text: string): string {
  let t = text.trim();
  if (t.startsWith("```json")) {
    t = t.slice("```json".length).trim();
  } else if (t.startsWith("```")) {
    t = t.slice(3).trim();
  }
  if (t.endsWith("```")) {
    t = t.slice(0, -"```".length).trim();
  }
  return t;
}

function parseAndValidateResponse(rawJson: string): ReviewResult {
  let parsed: unknown = tryParseJson(rawJson);
  if (parsed === null) {
    parsed = tryParseJson(stripCodeFences(rawJson));
  }
  if (parsed === null) {
    return { comments: [], summary: "Could not parse AI response." };
  }

  if (!parsed || typeof parsed !== "object") {
    return { comments: [], summary: "Could not parse AI response." };
  }

  const obj = parsed as Record<string, unknown>;
  const rawComments = Array.isArray(obj.comments) ? obj.comments : [];
  const summary = typeof obj.summary === "string" ? obj.summary : "";

  const comments: ReviewComment[] = [];
  for (const item of rawComments) {
    if (!item || typeof item !== "object") continue;
    const c = item as Record<string, unknown>;
    const file = typeof c.file === "string" ? c.file : "";
    const issue = typeof c.issue === "string" ? c.issue : "";
    if (typeof c.fix !== "string") continue;
    const fix = c.fix;
    const sevRaw = typeof c.severity === "string" ? c.severity : "";
    if (!file || !issue || !SEVERITIES.has(sevRaw)) continue;
    const lineRaw = c.line;
    const lineNum =
      typeof lineRaw === "number" && Number.isFinite(lineRaw)
        ? Math.trunc(lineRaw)
        : Number.parseInt(String(lineRaw ?? ""), 10);
    const line = Number.isFinite(lineNum) ? lineNum : 0;
    comments.push({
      file,
      line,
      severity: sevRaw as ReviewComment["severity"],
      issue,
      fix,
    });
  }

  return { comments, summary };
}

export async function reviewDiff(files: PullRequestFile[]): Promise<ReviewResult> {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is not configured");
    }
    const client = new OpenAI({ apiKey });
    const diffText = formatDiffForPrompt(files);
    const chunks = chunkDiff(diffText);

    const runChunk = async (
      content: string,
      partIndex1: number,
      totalParts: number,
    ): Promise<ReviewResult> => {
      const userContent =
        totalParts === 1
          ? "Review this diff:\n\n" + content
          : `Review this diff (Part ${partIndex1} of ${totalParts}):\n\n${content}`;

      const completion = await client.chat.completions.create({
        model: "gpt-4o",
        response_format: { type: "json_object" },
        max_tokens: 4000,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userContent },
        ],
      });

      const raw = completion.choices[0]?.message?.content ?? "";
      return parseAndValidateResponse(raw);
    };

    let result: ReviewResult;

    if (chunks.length === 1) {
      result = await runChunk(chunks[0], 1, 1);
    } else {
      const partResults = await Promise.all(
        chunks.map((chunk, i) => runChunk(chunk, i + 1, chunks.length)),
      );

      result = {
        comments: partResults.flatMap((r) => r.comments),
        summary: partResults.map((r) => r.summary).join(" | "),
      };
    }

    if (result.comments.length === 0 && !result.summary.includes("clean")) {
      result.summary =
        "This PR appears clean — no significant issues were identified. " +
        result.summary;
    }

    return result;
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    throw new Error("OpenAI API error: " + msg);
  }
}
