import "../index.css";

import { page } from "vitest/browser";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

const nativeApi = vi.hoisted(() => ({
  onProvisionProgress: vi.fn(() => () => undefined),
  pickFolder: vi.fn(),
  filesystemBrowse: vi.fn(),
}));

vi.mock("../nativeApi", () => ({
  readNativeApi: () => ({
    dialogs: {
      pickFolder: nativeApi.pickFolder,
    },
    projects: {
      onProvisionProgress: nativeApi.onProvisionProgress,
    },
    filesystem: {
      browse: nativeApi.filesystemBrowse,
    },
  }),
}));

import { CreateProjectDialog } from "./CreateProjectDialog";

describe("CreateProjectDialog GitHub source", () => {
  afterEach(() => {
    nativeApi.onProvisionProgress.mockClear();
    nativeApi.pickFolder.mockReset();
    nativeApi.filesystemBrowse.mockReset();
  });

  it("disables GitHub when the server does not advertise provisioning", async () => {
    await render(
      <CreateProjectDialog
        open
        githubProvisioningAvailable={false}
        spaces={[]}
        activeSpaceId={null}
        defaultCloneParent="/Users/test/Developer"
        onOpenChange={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(
      (page.getByRole("radio", { name: "GitHub" }).element() as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("derives the clone folder from owner/repository and submits a parent directory", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const onOpenChange = vi.fn();
    await render(
      <CreateProjectDialog
        open
        githubProvisioningAvailable
        spaces={[]}
        activeSpaceId={null}
        defaultCloneParent="/Users/test/Developer"
        onOpenChange={onOpenChange}
        onSubmit={onSubmit}
      />,
    );

    await page.getByRole("radio", { name: "GitHub" }).click();
    expect(document.body.textContent).toContain("What you need");
    expect(document.body.textContent).toContain("Private access");
    await page.getByLabelText("Repository").fill("openai/codex");

    expect((page.getByLabelText("Folder name").element() as HTMLInputElement).value).toBe("codex");
    expect(document.body.textContent).toContain("Final location: /Users/test/Developer/codex");

    await page.getByRole("button", { name: "Clone and add" }).click();
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    const [value, options] = onSubmit.mock.calls[0] ?? [];
    expect(value).toMatchObject({
      source: "github",
      repository: "openai/codex",
      destinationParent: "/Users/test/Developer",
      directoryName: "codex",
      spaceId: null,
    });
    expect(value.operationId).toEqual(expect.any(String));
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });



  it("uses the native server folder picker in a browser", async () => {
    nativeApi.pickFolder.mockResolvedValue("/Users/test/Developer/synara");
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    await render(
      <CreateProjectDialog
        open
        githubProvisioningAvailable={false}
        spaces={[]}
        activeSpaceId={null}
        defaultCloneParent="/Users/test/Developer"
        onOpenChange={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    await page.getByRole("button", { name: "Choose folder" }).click();
    await vi.waitFor(() => expect(nativeApi.pickFolder).toHaveBeenCalledOnce());
    await page.getByRole("button", { name: "Create project", exact: true }).click();
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
      source: "local",
      workspaceRoot: "/Users/test/Developer/synara",
      createIfMissing: false,
    });
  });

  it("browses server folders and submits the selected server path", async () => {
    nativeApi.pickFolder.mockRejectedValue(new Error("native unavailable"));
    nativeApi.filesystemBrowse.mockImplementation(async ({ partialPath }: { partialPath: string }) =>
      partialPath === "/Users/test/Developer/"
        ? {
            parentPath: "/Users/test/Developer",
            entries: [{ name: "synara", fullPath: "/Users/test/Developer/synara" }],
          }
        : { parentPath: "/Users/test/Developer/synara", entries: [] },
    );
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    await render(
      <CreateProjectDialog
        open
        githubProvisioningAvailable={false}
        spaces={[]}
        activeSpaceId={null}
        defaultCloneParent="/Users/test/Developer"
        onOpenChange={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    await page.getByRole("button", { name: "Choose folder" }).click();
    await expect.element(page.getByRole("heading", { name: "Choose a server folder" })).toBeInTheDocument();
    await expect.element(page.getByRole("button", { name: "synara" })).toBeInTheDocument();
    await page.getByRole("button", { name: "synara" }).click();
    await expect.element(page.getByLabelText("Current server folder")).toHaveTextContent("/Users/test/Developer/synara");
    await page.getByRole("button", { name: "Use this folder" }).click();
    await page.getByRole("button", { name: "Create project", exact: true }).click();

    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
      source: "local",
      workspaceRoot: "/Users/test/Developer/synara",
      createIfMissing: false,
      spaceId: null,
    });
  });

  it("keeps the server-folder picker open when browsing fails", async () => {
    nativeApi.pickFolder.mockRejectedValue(new Error("native unavailable"));
    nativeApi.filesystemBrowse.mockRejectedValue(new Error("Permission denied"));
    await render(
      <CreateProjectDialog
        open
        githubProvisioningAvailable={false}
        spaces={[]}
        activeSpaceId={null}
        defaultCloneParent="/Users/test/Developer"
        onOpenChange={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    await page.getByRole("button", { name: "Choose folder" }).click();
    await expect.element(page.getByRole("alert")).toHaveTextContent("Permission denied");
    await expect.element(page.getByRole("heading", { name: "Choose a server folder" })).toBeInTheDocument();
  });

  it("navigates into a child folder and back to its parent", async () => {
    nativeApi.pickFolder.mockRejectedValue(new Error("native unavailable"));
    nativeApi.filesystemBrowse
      .mockResolvedValueOnce({
        parentPath: "/Users/test/Developer",
        entries: [{ name: "synara", fullPath: "/Users/test/Developer/synara" }],
      })
      .mockResolvedValueOnce({
        parentPath: "/Users/test/Developer/synara",
        entries: [],
      })
      .mockResolvedValueOnce({
        parentPath: "/Users/test/Developer",
        entries: [{ name: "synara", fullPath: "/Users/test/Developer/synara" }],
      });
    await render(
      <CreateProjectDialog
        open
        githubProvisioningAvailable={false}
        spaces={[]}
        activeSpaceId={null}
        defaultCloneParent="/Users/test/Developer"
        onOpenChange={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    await page.getByRole("button", { name: "Choose folder" }).click();
    await page.getByRole("button", { name: "synara" }).click();
    await page.getByRole("button", { name: "Go to parent folder" }).click();
    await vi.waitFor(() =>
      expect(nativeApi.filesystemBrowse).toHaveBeenLastCalledWith({
        partialPath: "/Users/test/Developer/",
      }),
    );
  });

  it("rejects invalid clone folder names before provisioning", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    await render(
      <CreateProjectDialog
        open
        githubProvisioningAvailable
        spaces={[]}
        activeSpaceId={null}
        defaultCloneParent="/Users/test/Developer"
        onOpenChange={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    await page.getByRole("radio", { name: "GitHub" }).click();
    await page.getByLabelText("Repository").fill("openai/codex");
    await page.getByLabelText("Folder name").fill("CON");
    await page.getByRole("button", { name: "Clone and add" }).click();

    await expect.element(page.getByRole("alert")).toHaveTextContent("Choose a valid folder name");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("aborts the active clone when the dialog is closed", async () => {
    const submittedSignals: AbortSignal[] = [];
    const onSubmit = vi.fn(
      (_value: unknown, options: { signal: AbortSignal }) =>
        new Promise<void>((_resolve, reject) => {
          submittedSignals.push(options.signal);
          options.signal.addEventListener("abort", () => reject(new Error("cancelled")), {
            once: true,
          });
        }),
    );
    const onOpenChange = vi.fn();
    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <CreateProjectDialog
          open={open}
          githubProvisioningAvailable
          spaces={[]}
          activeSpaceId={null}
          defaultCloneParent="/Users/test"
          onOpenChange={(nextOpen) => {
            onOpenChange(nextOpen);
            setOpen(nextOpen);
          }}
          onSubmit={onSubmit}
        />
      );
    }
    await render(<Harness />);

    await page.getByRole("radio", { name: "GitHub" }).click();
    await page.getByLabelText("Repository").fill("openai/codex");
    await page.getByRole("button", { name: "Clone and add" }).click();
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    await page.getByRole("button", { name: "Cancel clone" }).click();

    expect(submittedSignals[0]?.aborted).toBe(true);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
