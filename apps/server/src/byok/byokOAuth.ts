import { spawn } from "node:child_process";

import { buildCursorAgentCommand } from "../provider/acp/CursorAcpCommand.ts";

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

export function resolveByokOAuthCommand(
  provider: string,
  action: "login" | "logout",
  executableOverride?: string,
): OAuthCommand | null {
  const command = byokOAuthCommand(provider, action);
  if (!command) return null;
  if (provider !== "cursor") {
    return {
      executable: executableOverride?.trim() || command.executable,
      args: [...command.args],
    };
  }
  const resolved = buildCursorAgentCommand(executableOverride || command.executable, command.args);
  return { executable: resolved.command, args: [...resolved.args] };
}

export function oauthExecutableMissingMessage(provider: string, executable: string): string {
  if (provider === "cursor") {
    return `Cursor Agent CLI was not found (${executable}). Install Cursor CLI or set the Cursor binary path in Settings → Providers.`;
  }
  return `${executable} was not found. Install the provider CLI or set its binary path in Settings → Providers.`;
}

/** Runs the provider-owned browser/callback flow without passing secrets. */
export function launchByokOAuth(
  provider: string,
  action: "login" | "logout",
  executableOverride?: string,
): Promise<OAuthCommand> {
  const launchCommand = resolveByokOAuthCommand(provider, action, executableOverride);
  if (!launchCommand) return Promise.reject(new Error(`OAuth is not supported for provider: ${provider}`));

  return new Promise((resolve, reject) => {
    const child = spawn(launchCommand.executable, [...launchCommand.args], {
      stdio: "ignore",
      windowsHide: true,
    });
    let settled = false;
    child.once("error", (error: NodeJS.ErrnoException) => {
      settled = true;
      reject(
        error.code === "ENOENT"
          ? new Error(oauthExecutableMissingMessage(provider, launchCommand.executable))
          : error,
      );
    });
    child.once("close", (code, signal) => {
      if (settled) return;
      if (code === 0) {
        resolve(launchCommand);
        return;
      }
      reject(
        new Error(
          `${launchCommand.executable} ${launchCommand.args.join(" ")} exited with ${
            signal ? `signal ${signal}` : `code ${code ?? "unknown"}`
          }.`,
        ),
      );
    });
  });
}
