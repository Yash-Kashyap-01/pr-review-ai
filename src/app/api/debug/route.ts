export async function GET(): Promise<Response> {
  const openaiKey = process.env.OPENAI_API_KEY;
  const githubToken = process.env.GITHUB_TOKEN;

  return Response.json({
    openai: {
      set: !!openaiKey,
      valid: openaiKey?.startsWith("sk-") ?? false,
      preview: openaiKey ? openaiKey.slice(0, 7) + "..." : "NOT SET",
    },
    github: {
      set: !!githubToken,
      valid: (githubToken?.length ?? 0) > 10,
      preview: githubToken ? githubToken.slice(0, 8) + "..." : "NOT SET",
    },
    node_env: process.env.NODE_ENV,
    timestamp: new Date().toISOString(),
  });
}
