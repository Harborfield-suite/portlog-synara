import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

type NativePickerCommandError = Error & {
  readonly code?: string | number;
  readonly stderr?: string;
};

export type NativeFolderPickerPlatform = "darwin" | "linux" | "win32";

export type NativeFolderPickerExecFile = (
  file: string,
  args: readonly string[],
) => Promise<{ readonly stdout: string }>;

export interface NativeFolderPickerOptions {
  readonly platform?: NativeFolderPickerPlatform;
  readonly execFile?: NativeFolderPickerExecFile;
}

const MACOS_FOLDER_PICKER_SCRIPT =
  'POSIX path of (choose folder with prompt "Choose a project folder")';
const WINDOWS_FOLDER_PICKER_SCRIPT = [
  "Add-Type -AssemblyName System.Windows.Forms",
  "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
  "$dialog.Description = 'Choose a project folder'",
  "$dialog.ShowNewFolderButton = $false",
  "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { $dialog.SelectedPath }",
].join("; ");

function isCancelledPickerError(
  error: unknown,
  cancellationExitCodes: readonly number[],
): boolean {
  const message = error instanceof Error ? error.message : String(error);
  if (/user cancel|user abort|cancelled|canceled/i.test(message)) return true;
  if (!(error instanceof Error)) return false;
  const commandError = error as NativePickerCommandError;
  return (
    typeof commandError.code === "number" &&
    cancellationExitCodes.includes(commandError.code) &&
    typeof commandError.stderr === "string" &&
    commandError.stderr.trim().length === 0
  );
}

async function runPickerCommand(
  file: string,
  args: readonly string[],
  exec: NativeFolderPickerExecFile,
  cancellationExitCodes: readonly number[] = [],
): Promise<string | null> {
  try {
    const result = await exec(file, args);
    const selectedPath = result.stdout.trim();
    return selectedPath.length > 0 ? selectedPath : null;
  } catch (error) {
    if (isCancelledPickerError(error, cancellationExitCodes)) return null;
    throw error;
  }
}

export async function pickNativeFolder(options: NativeFolderPickerOptions = {}): Promise<string | null> {
  const platform = options.platform ?? process.platform;
  const exec = options.execFile ?? ((file, args) => execFileAsync(file, [...args], { encoding: "utf8" }));

  if (platform === "darwin") {
    return runPickerCommand("/usr/bin/osascript", ["-e", MACOS_FOLDER_PICKER_SCRIPT], exec);
  }

  if (platform === "win32") {
    return runPickerCommand(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", WINDOWS_FOLDER_PICKER_SCRIPT],
      exec,
    );
  }

  try {
    return await runPickerCommand(
      "zenity",
      ["--file-selection", "--directory", "--title=Choose a project folder"],
      exec,
      [1],
    );
  } catch (error) {
    const commandError = error as NativePickerCommandError;
    if (commandError.code !== "ENOENT") throw error;
    return runPickerCommand(
      "kdialog",
      ["--getexistingdirectory", "--title", "Choose a project folder"],
      exec,
      [1],
    );
  }
}
