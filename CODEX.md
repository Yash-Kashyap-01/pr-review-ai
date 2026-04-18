---
# PR Review AI — Codex Project Context

## What this app does
A web app where a user pastes a public GitHub Pull Request URL and receives a
structured, senior-engineer-quality code review powered by GPT-4o.

## Stack
- Next.js 14 with App Router (TypeScript, src/ directory layout)
- Tailwind CSS (dark theme, bg-gray-950)
- OpenAI API (model: gpt-4o)
- Deployed on Vercel

## File structure
src/
  app/
    page.tsx              — main UI (client component)
    layout.tsx            — root layout with dark background + nav
    api/
      review/
        route.ts          — POST endpoint: receives PR URL, returns review JSON
  lib/
    github.ts             — fetches PR diff from GitHub REST API
    openai.ts             — sends diff to GPT-4o, returns structured review
  components/
    ReviewCard.tsx        — renders one review comment
    Spinner.tsx           — animated loading spinner

## POST /api/review contract
  Body:    { "prUrl": "https://github.com/owner/repo/pull/123" }
  Success: { "comments": [...], "summary": "..." }
  Error:   { "error": "message" }  (status 400)

## ReviewComment shape
  { file: string, line: number, severity: "critical"|"warning"|"suggestion",
    issue: string, fix: string }

## Rules
- No database, no auth, no Docker — pure stateless
- All API responses must set Cache-Control: no-store
- Total files reviewed capped at 50
- Request timeout: 55 seconds
---
