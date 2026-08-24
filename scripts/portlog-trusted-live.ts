import { spawn } from "node:child_process";

const CREDENTIAL_KEYS = [
  "PORTLOG_OPENROUTER_API_KEY",
  "OPENROUTER_API_KEY",
  "PORTLOG_OPENAI_API_KEY",
  "OPENAI_API_KEY",
] as const;

type Environment = NodeJS.ProcessEnv;

export function resolveCredential(environment: Environment): string {
  const credential = environment.PORTLOG_OPENROUTER_API_KEY?.trim() || environment.OPENROUTER_API_KEY?.trim();
  if (!credential) {
    throw new Error("PORTLOG_OPENROUTER_API_KEY or OPENROUTER_API_KEY must be set in the trusted host shell");
  }
  return credential;
}

export function createTrustedChildEnvironment(environment: Environment, credential: string): Environment {
  const childEnvironment: Environment = { ...environment, PORTLOG_OPENROUTER_API_KEY: credential };
  for (const key of CREDENTIAL_KEYS) {
    if (key !== "PORTLOG_OPENROUTER_API_KEY") delete childEnvironment[key];
  }
  return childEnvironment;
}

function main(): void {
  const [mode = "baseline", ...args] = process.argv.slice(2);
  if (mode !== "baseline" && mode !== "smoke" && mode !== "proof") {
    throw new Error(`unknown mode '${mode}'; use 'baseline', 'smoke', or 'proof'`);
  }
  const credential = resolveCredential(process.env);
  const runtimeCommand = mode === "smoke"
    ? "live-smoke"
    : mode === "proof"
      ? "product-proof"
      : "baseline";
  const child = spawn(
    "bun",
    ["run", "--cwd", "apps/portlog-runtime", runtimeCommand, ...(args.length > 0 ? ["--", ...args] : [])],
    {
      cwd: process.cwd(),
      env: createTrustedChildEnvironment(process.env, credential),
      stdio: "inherit",
    },
  );
  child.on("error", (error) => {
    console.error(`trusted PortLog ${mode} launcher failed: ${error.message}`);
    process.exitCode = 1;
  });
  child.on("exit", (code, signal) => {
    if (signal) {
      console.error(`trusted PortLog ${mode} launcher stopped by ${signal}`);
      process.exitCode = 1;
    } else {
      process.exitCode = code ?? 1;
    }
  });
}

if (import.meta.main) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
