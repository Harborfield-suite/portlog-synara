// FILE: EnvironmentEditorSection.browser.tsx
// Purpose: Covers the Environment editor section's external-editor action surface.
// Layer: Vitest browser tests

import "../../../index.css";

import type { ResolvedKeybindingsConfig } from "@synara/contracts";
import { page } from "vitest/browser";
import { afterEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";

import { EnvironmentEditorSection } from "./EnvironmentEditorSection";

const EMPTY_KEYBINDINGS: ResolvedKeybindingsConfig = [];

describe("EnvironmentEditorSection", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("does not show an in-app editor-view row in the Environment panel", async () => {
    await render(
      <EnvironmentEditorSection
        keybindings={EMPTY_KEYBINDINGS}
        availableEditors={["cursor"]}
        openInTarget="/workspace/project"
      />,
    );

    await expect.element(page.getByText("Editor view")).not.toBeInTheDocument();
    await expect.element(page.getByRole("button", { name: /Open in Cursor/ })).toBeInTheDocument();
  });
});
