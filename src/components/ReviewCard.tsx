"use client";

interface ReviewComment {
  file: string;
  line: number;
  severity: "critical" | "warning" | "suggestion";
  issue: string;
  fix: string;
}

const SEVERITY_STYLES = {
  critical:   { badge: "bg-red-500/20 text-red-400 border border-red-500/30",   label: "Critical"   },
  warning:    { badge: "bg-yellow-400/20 text-yellow-300 border border-yellow-400/30", label: "Warning"    },
  suggestion: { badge: "bg-green-400/20 text-green-400 border border-green-400/30",  label: "Suggestion" },
};

export default function ReviewCard({ comment }: { comment: ReviewComment }) {
  const style = SEVERITY_STYLES[comment.severity];
  return (
    <div className="bg-gray-900 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold uppercase ${style.badge}`}>
          {style.label}
        </span>
        {comment.line > 0 && (
          <span className="text-gray-500 text-xs">Line {comment.line}</span>
        )}
      </div>
      <div>
        <p className="text-gray-500 text-xs uppercase tracking-wider mb-1">Issue</p>
        <p className="text-gray-100 text-sm leading-relaxed">{comment.issue}</p>
      </div>
      <div>
        <p className="text-gray-500 text-xs uppercase tracking-wider mb-1">Fix</p>
        <pre className="text-gray-300 text-sm font-mono bg-gray-800 rounded p-3 whitespace-pre-wrap leading-relaxed overflow-x-auto">
          {comment.fix}
        </pre>
      </div>
    </div>
  );
}
