import { describe, expect, it } from "vitest";

import { diffRouteSearchEquals, parseDiffRouteSearch } from "./diffRouteSearch";

describe("diffRouteSearchEquals", () => {
  it("detects editor route and selected file changes", () => {
    expect(diffRouteSearchEquals({}, { view: "editor" })).toBe(false);
    expect(
      diffRouteSearchEquals(
        { view: "editor", editorFilePath: "src/first.ts" },
        { view: "editor", editorFilePath: "src/second.ts" },
      ),
    ).toBe(false);
    expect(
      diffRouteSearchEquals(
        { view: "editor", editorFilePath: "src/first.ts" },
        { view: "editor", editorFilePath: "src/first.ts" },
      ),
    ).toBe(true);
  });
  it("parses the model viewer without carrying editor file state", () => {
    expect(
      parseDiffRouteSearch({
        view: "model",
        editorFilePath: "src/ignored.ts",
      }),
    ).toEqual({ view: "model" });
  });

  it("accepts the explicit chat route used to leave the project editor", () => {
    expect(parseDiffRouteSearch({ view: "chat" })).toEqual({ view: "chat" });
    expect(diffRouteSearchEquals({ view: "chat" }, { view: "chat" })).toBe(true);
    expect(diffRouteSearchEquals({ view: "editor" }, { view: "chat" })).toBe(false);
  });

  it("accepts the model viewer route", () => {
    expect(diffRouteSearchEquals({ view: "model" }, { view: "model" })).toBe(true);
    expect(diffRouteSearchEquals({ view: "editor" }, { view: "model" })).toBe(false);
  });
});

describe("parseDiffRouteSearch", () => {
  it("parses valid diff search values", () => {
    const parsed = parseDiffRouteSearch({
      panel: "diff",
      diff: "1",
      diffTurnId: "turn-1",
      diffFilePath: "src/app.ts",
    });

    expect(parsed).toEqual({
      panel: "diff",
      diff: "1",
      diffTurnId: "turn-1",
      diffFilePath: "src/app.ts",
    });
  });

  it("treats numeric and boolean diff toggles as open", () => {
    expect(
      parseDiffRouteSearch({
        diff: 1,
        diffTurnId: "turn-1",
      }),
    ).toEqual({
      panel: "diff",
      diff: "1",
      diffTurnId: "turn-1",
    });

    expect(
      parseDiffRouteSearch({
        diff: true,
        diffTurnId: "turn-1",
      }),
    ).toEqual({
      panel: "diff",
      diff: "1",
      diffTurnId: "turn-1",
    });
  });

  it("drops turn and file values when diff is closed", () => {
    const parsed = parseDiffRouteSearch({
      diff: "0",
      diffTurnId: "turn-1",
      diffFilePath: "src/app.ts",
    });

    expect(parsed).toEqual({});
  });

  it("preserves file value for repo diff selections without a turn", () => {
    const parsed = parseDiffRouteSearch({
      diff: "1",
      diffFilePath: "src/app.ts",
    });

    expect(parsed).toEqual({
      panel: "diff",
      diff: "1",
      diffFilePath: "src/app.ts",
    });
  });

  it("normalizes whitespace-only values", () => {
    const parsed = parseDiffRouteSearch({
      diff: "1",
      diffTurnId: "  ",
      diffFilePath: "  ",
    });

    expect(parsed).toEqual({
      panel: "diff",
      diff: "1",
    });
  });

  it("preserves browser panel mode without diff state", () => {
    const parsed = parseDiffRouteSearch({
      panel: "browser",
      diffTurnId: "turn-1",
    });

    expect(parsed).toEqual({
      panel: "browser",
    });
  });

  it("preserves split route state while normalizing unrelated values", () => {
    const parsed = parseDiffRouteSearch({
      panel: "browser",
      diffTurnId: "turn-1",
      splitViewId: " split-1 ",
    });

    expect(parsed).toEqual({
      panel: "browser",
      splitViewId: "split-1",
    });
  });
});
