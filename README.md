# PR Review AI

> Get a senior engineer code review on any public GitHub PR in seconds — powered by GPT-4o.

## What it does
- Paste any public GitHub PR URL
- Fetches the full diff via GitHub REST API
- Sends it to GPT-4o with a senior-engineer system prompt
- Returns structured comments grouped by file with severity badges and fix suggestions

## Stack
Next.js 14 (App Router) · TypeScript · Tailwind CSS · OpenAI GPT-4o · Vercel

## Getting started
```bash
git clone <your-repo-url>
cd pr-review-ai
npm install
cp .env.local.example .env.local
# Edit .env.local with your keys
npm run dev
```
Open http://localhost:3000

## Environment variables
| Variable | Required | Description |
|---|---|---|
| OPENAI_API_KEY | Yes | From platform.openai.com/api-keys |
| GITHUB_TOKEN | Recommended | From github.com/settings/tokens — raises rate limit from 60 to 5000 req/hr |

## Demo PRs
- https://github.com/OWASP/NodeGoat/pull/226 (security issues)
- https://github.com/gothinkster/realworld/pull/388 (code quality)

## Architecture
User → Next.js UI → POST /api/review → GitHub REST API (fetch diff) → GPT-4o (review) → Structured JSON → Rendered cards

## License
MIT
