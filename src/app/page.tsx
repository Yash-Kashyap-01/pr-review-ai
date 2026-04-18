"use client";

import { useEffect, useState } from "react";
import ReviewCard from "@/components/ReviewCard";
import Spinner from "@/components/Spinner";

interface ReviewComment {
  file: string;
  line: number;
  severity: "critical" | "warning" | "suggestion";
  issue: string;
  fix: string;
}

interface ReviewResult {
  comments: ReviewComment[];
  summary: string;
  fileCount?: number;
}

function generateMarkdown(result: ReviewResult, prUrl: string): string {
  return (
    "# PR Review: " +
    prUrl +
    "\n\n" +
    "## Summary\n" +
    result.summary +
    "\n\n" +
    "## Comments\n\n" +
    result.comments
      .map(
        (c) =>
          "### " +
          c.file +
          " (Line " +
          c.line +
          ")\n" +
          "**Severity:** " +
          c.severity +
          "\n\n" +
          "**Issue:** " +
          c.issue +
          "\n\n" +
          "**Fix:**\n```\n" +
          c.fix +
          "\n```",
      )
      .join("\n\n---\n\n")
  );
}

export default function Home() {
  const [prUrl, setPrUrl] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">(
    "idle",
  );
  const [statusText, setStatusText] = useState("");
  const [result, setResult] = useState<ReviewResult | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [fileCount, setFileCount] = useState(0);
  const [copyLabel, setCopyLabel] = useState("Copy Review as Markdown");

  useEffect(() => {
    if (status !== "loading") return;

    const messages = [
      "Fetching PR diff from GitHub...",
      "Analyzing code changes...",
      "Running security checks...",
      "Generating review comments...",
    ];
    setStatusText(messages[0]);
    let i = 1;
    const interval = setInterval(() => {
      if (i < messages.length) {
        setStatusText(messages[i]);
        i++;
      }
    }, 3500);
    return () => clearInterval(interval);
  }, [status]);

  async function handleReview() {
    if (!prUrl.trim()) return;

    if (!prUrl.includes("github.com") || !prUrl.includes("/pull/")) {
      setStatus("error");
      setErrorMessage(
        "Please enter a valid GitHub PR URL — e.g. https://github.com/owner/repo/pull/123",
      );
      return;
    }

    setStatus("loading");
    setResult(null);
    setErrorMessage("");

    try {
      const res = await fetch("/api/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prUrl: prUrl.trim() }),
      });
      const data = (await res.json()) as ReviewResult & { error?: string };
      if (!res.ok) {
        throw new Error(data.error || "Review failed");
      }
      const headerCount = parseInt(
        res.headers.get("X-Review-File-Count") || "0",
        10,
      );
      setFileCount(headerCount || data.fileCount || 0);
      setResult(data);
      setStatus("success");
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Something went wrong",
      );
      setStatus("error");
    }
  }

  async function handleCopy() {
    if (!result) return;
    await navigator.clipboard.writeText(generateMarkdown(result, prUrl));
    setCopyLabel("✓ Copied!");
    setTimeout(() => setCopyLabel("Copy Review as Markdown"), 2000);
  }

  const grouped = (result?.comments || []).reduce(
    (acc, c) => {
      if (!acc[c.file]) acc[c.file] = [];
      acc[c.file].push(c);
      return acc;
    },
    {} as Record<string, ReviewComment[]>,
  );
  const sortedFiles = Object.keys(grouped).sort();

  return (
    <main className="min-h-screen bg-gray-950">
      <div className="max-w-3xl mx-auto px-4 py-16 text-center">
        <h1 className="text-5xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent mb-3">
          PR Review AI
        </h1>
        <p className="text-gray-400 text-lg mb-10">
          Paste a GitHub PR URL and get a senior engineer code review in seconds
        </p>

        <div className="flex flex-col sm:flex-row gap-3">
          <input
            type="url"
            value={prUrl}
            onChange={(e) => setPrUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void handleReview()}
            disabled={status === "loading"}
            placeholder="https://github.com/expressjs/express/pull/3276"
            className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-gray-100 placeholder-gray-600 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:opacity-50 text-sm"
          />
          <button
            type="button"
            onClick={() => void handleReview()}
            disabled={status === "loading" || !prUrl.trim()}
            className="w-full sm:w-auto bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:cursor-not-allowed text-white font-semibold px-6 py-3 rounded-lg transition-colors duration-150 text-sm"
          >
            {status === "loading" ? "Reviewing..." : "Review PR →"}
          </button>
        </div>

        <p className="text-gray-600 text-xs mt-4">
          Try an example:{" "}
          <button
            type="button"
            onClick={() =>
              setPrUrl("https://github.com/expressjs/express/pull/3276")
            }
            className="text-blue-500 hover:text-blue-400 underline"
          >
            expressjs/express #3276
          </button>
          {" · "}
          <button
            type="button"
            onClick={() =>
              setPrUrl("https://github.com/facebook/react/pull/11347")
            }
            className="text-blue-500 hover:text-blue-400 underline"
          >
            facebook/react #11347
          </button>
        </p>
      </div>

      {status === "loading" && (
        <div className="max-w-3xl mx-auto px-4 pb-16 text-center">
          <Spinner />
          <p className="text-gray-400 text-sm mt-4 animate-pulse">{statusText}</p>
        </div>
      )}

      {status === "error" && (
        <div className="max-w-3xl mx-auto px-4 pb-16">
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-5">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-red-400 font-semibold">⚠ Error</p>
                <p className="text-red-300 text-sm mt-1">{errorMessage}</p>
              </div>
              <button
                type="button"
                onClick={() => setStatus("idle")}
                className="text-gray-500 hover:text-gray-300 text-sm ml-4"
              >
                Try again
              </button>
            </div>
          </div>
        </div>
      )}

      {status === "success" && result && (
        <div className="max-w-4xl mx-auto px-4 pb-20">
          <div className="flex justify-between items-center mb-6">
            <p className="text-gray-600 text-xs">
              Reviewed {fileCount} file{fileCount !== 1 ? "s" : ""} · Powered by
              GPT-4o
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void handleCopy()}
                className="bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm px-4 py-2 rounded-lg border border-gray-700 transition-colors"
              >
                {copyLabel}
              </button>
              <button
                type="button"
                onClick={() => {
                  setStatus("idle");
                  setResult(null);
                  setErrorMessage("");
                }}
                className="bg-gray-800 hover:bg-gray-700 text-gray-400 text-sm px-3 py-2 rounded-lg border border-gray-700 transition-colors"
              >
                New Review
              </button>
            </div>
          </div>

          <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-5 mb-6">
            <p className="text-blue-400 font-semibold text-sm uppercase tracking-wider mb-2">
              Review Summary
            </p>
            <p className="text-gray-200 leading-relaxed">{result.summary}</p>
          </div>

          {result.comments.length > 0 && (
            <div className="flex flex-wrap gap-3 mb-8">
              {(["critical", "warning", "suggestion"] as const).map((sev) => {
                const n = result.comments.filter((c) => c.severity === sev).length;
                if (n === 0) return null;
                const styles = {
                  critical: "bg-red-500/20 text-red-400 border-red-500/30",
                  warning: "bg-yellow-400/20 text-yellow-300 border-yellow-400/30",
                  suggestion:
                    "bg-green-400/20 text-green-400 border-green-400/30",
                };
                return (
                  <span
                    key={sev}
                    className={`rounded-full px-3 py-1 text-sm font-medium border ${styles[sev]}`}
                  >
                    {n} {sev.charAt(0).toUpperCase() + sev.slice(1)}
                    {n !== 1 ? "s" : ""}
                  </span>
                );
              })}
            </div>
          )}

          {result.comments.length === 0 && (
            <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-12 text-center">
              <p className="text-4xl mb-3">✅</p>
              <p className="text-green-400 font-semibold text-xl">
                No issues found!
              </p>
              <p className="text-gray-400 mt-2">
                This PR looks clean. No critical issues, warnings, or suggestions
                were identified.
              </p>
            </div>
          )}

          {sortedFiles.map((filename) => (
            <div key={filename} className="mb-6">
              <div className="bg-gray-900 border border-gray-800 border-b-gray-900 rounded-t-lg px-4 py-3 flex items-center justify-between">
                <span className="font-mono text-sm text-gray-300 truncate max-w-lg">
                  📁 {filename}
                </span>
                <span className="text-gray-500 text-xs ml-4 flex-shrink-0">
                  {grouped[filename].length} issue
                  {grouped[filename].length !== 1 ? "s" : ""}
                </span>
              </div>
              <div className="border border-gray-800 border-t-0 rounded-b-lg divide-y divide-gray-800 overflow-hidden">
                {grouped[filename].map((comment, idx) => (
                  <ReviewCard key={idx} comment={comment} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
