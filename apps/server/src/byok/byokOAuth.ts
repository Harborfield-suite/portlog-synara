import { spawn } from "node:child_process";

export type ByokOAuthProvider = "openai-codex" | "cursor";

type OAuthCommand = {
  readonly executable: string;
  readonly args: readonly string[];
};

const COMMANDS: Readonly<Record<ByokOAuthProvider, { login: OAuthCommand; logout: OAuthCommand }>> = {
  "openai-codex": {
    login: { executable: "codex", args: ["login"] },
    logout: { executable: "codex", args: ["logout"] },
  },
  cursor: {
    login: { executable: "cursor-agent", args: ["login"] },
    logout: { executable: "cursor-agent", args: ["logout"] },
  },
};

export function byokOAuthCommand(
  provider: string,
  action: "login" | "logout",
): OAuthCommand | null {
  const command = COMMANDS[provider.trim() as ByokOAuthProvider];
  return command?.[action] ?? null;
}

export function supportedByokOAuthProvider(provider: string): provider is ByokOAuthProvider {
  return byokOAuthCommand(provider, "login") !== null;
}

/** Runs the provider-owned browser/callback flow without passing secrets. */
export function launchByokOAuth(
  provider: string,
  action: "login" | "logout",
): Promise<OAuthCommand> {
  const command = byokOAuthCommand(provider, action);
  if (!command) return Promise.reject(new Error(`OAuth is not supported for provider: ${provider}`));

  return new Promise((resolve, reject) => {
    const child = spawn(command.executable, [...command.args], {
      stdio: "ignore",
      windowsHide: true,
    });
    let settled = false;
    child.once("error", (error) => {
      settled = true;
      reject(error);
    });
    child.once("close", (code, signal) => {
      if (settled) return;
      if (code === 0) {
        resolve(command);
        return;
      }
      reject(
        new Error(
          `${command.executable} ${command.args.join(" ")} exited with ${
            signal ? `signal ${signal}` : `code ${code ?? "unknown"}`
          }.`,
        ),
      );
    });
  });
}
