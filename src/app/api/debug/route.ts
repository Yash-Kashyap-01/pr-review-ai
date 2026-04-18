export async function GET(): Promise<Response> {
  const openaiKey = process.env.OPENAI_API_KEY
  const githubToken = process.env.GITHUB_TOKEN

  // Test GitHub API reachability
  let githubStatus = 'untested'
  let rateLimitRemaining = 'unknown'
  try {
    const headers: Record<string, string> = {
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'pr-review-ai/1.0'
    }
    if (githubToken && githubToken.length > 10) {
      headers['Authorization'] = `Bearer ${githubToken}`
    }
    const res = await fetch('https://api.github.com/rate_limit', { headers })
    const data = await res.json() as { rate?: { remaining?: number } }
    githubStatus = res.status === 200 ? 'reachable' : `HTTP ${res.status}`
    rateLimitRemaining = String(data?.rate?.remaining ?? 'unknown')
  } catch (e) {
    githubStatus = `error: ${e instanceof Error ? e.message : 'unknown'}`
  }

  return Response.json({
    openai: {
      set: !!openaiKey,
      valid: openaiKey?.startsWith('sk-') ?? false,
      preview: openaiKey ? openaiKey.slice(0, 7) + '***' : 'NOT SET'
    },
    github: {
      token_set: !!githubToken && githubToken.length > 10,
      preview: githubToken ? githubToken.slice(0, 8) + '***' : 'NOT SET',
      api_status: githubStatus,
      rate_limit_remaining: rateLimitRemaining
    },
    node_env: process.env.NODE_ENV,
    timestamp: new Date().toISOString()
  })
}
