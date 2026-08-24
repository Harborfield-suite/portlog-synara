export const PORTLOG_TOOL_POLICY = ["read", "write", "edit", "bash"] as const;

const CREDENTIAL_ENV_KEYS = [
  "PORTLOG_OPENROUTER_API_KEY",
  "OPENROUTER_API_KEY",
  "PORTLOG_OPENAI_API_KEY",
  "OPENAI_API_KEY",
] as const;

export function sanitizeBashEnvironment(context: {
  readonly command: string;
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
}) {
  const env = { ...context.env };
  for (const key of CREDENTIAL_ENV_KEYS) delete env[key];
  return { ...context, env };
}
