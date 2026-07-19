import { describe, test, expect } from "bun:test";
import {
  bumpRecent,
  toggleFavorite,
  setProjectColor,
  setProjectTracking,
  cycleProjectColor,
  clearRecents,
  clearFavorites,
  clearTints,
  resetState,
  countTints,
  PROJECT_COLOR_PALETTE,
  type State,
} from "./state.ts";

const empty = (): State => ({ recents: [], favorites: [], perProject: {} });

describe("bumpRecent", () => {
  test("adds new path to the front", () => {
    const s = bumpRecent(empty(), "/a");
    expect(s.recents).toEqual(["/a"]);
  });

  test("moves existing path to the front without duplicating", () => {
    const base: State = { ...empty(), recents: ["/a", "/b", "/c"] };
    const s = bumpRecent(base, "/b");
    expect(s.recents).toEqual(["/b", "/a", "/c"]);
  });

  test("respects the cap", () => {
    const base: State = {
      ...empty(),
      recents: ["/a", "/b", "/c", "/d", "/e", "/f", "/g", "/h"],
    };
    const s = bumpRecent(base, "/new", 3);
    expect(s.recents).toEqual(["/new", "/a", "/b"]);
  });
});

describe("toggleFavorite", () => {
  test("adds when absent", () => {
    expect(toggleFavorite(empty(), "/a").favorites).toEqual(["/a"]);
  });
  test("removes when present", () => {
    const s = toggleFavorite({ ...empty(), favorites: ["/a", "/b"] }, "/a");
    expect(s.favorites).toEqual(["/b"]);
  });
});

describe("setProjectColor / cycleProjectColor", () => {
  test("setProjectColor stores color under perProject", () => {
    const s = setProjectColor(empty(), "/a", "#8b4a3a");
    expect(s.perProject["/a"].color).toBe("#8b4a3a");
  });
  test("cycleProjectColor from undefined returns first palette color", () => {
    expect(cycleProjectColor(undefined)).toBe(PROJECT_COLOR_PALETTE[0]);
  });
  test("cycleProjectColor from last palette entry returns undefined", () => {
    const last = PROJECT_COLOR_PALETTE[PROJECT_COLOR_PALETTE.length - 1];
    expect(cycleProjectColor(last)).toBeUndefined();
  });
  test("cycleProjectColor advances one step", () => {
    expect(cycleProjectColor(PROJECT_COLOR_PALETTE[0])).toBe(
      PROJECT_COLOR_PALETTE[1],
    );
  });
  test("cycleProjectColor from unknown color returns first palette color", () => {
    expect(cycleProjectColor("#ffffff")).toBe(PROJECT_COLOR_PALETTE[0]);
  });
});

describe("clear helpers", () => {
  test("clearRecents empties the array", () => {
    const s = clearRecents({ ...empty(), recents: ["/a"] });
    expect(s.recents).toEqual([]);
  });
  test("clearFavorites empties the array", () => {
    const s = clearFavorites({ ...empty(), favorites: ["/a"] });
    expect(s.favorites).toEqual([]);
  });
  test("clearTints removes color but preserves other per-project fields", () => {
    const s = clearTints({
      ...empty(),
      perProject: {
        "/a": { color: "#8b4a3a", providerId: "claude-oauth" },
      },
    });
    expect(s.perProject["/a"].color).toBeUndefined();
    expect(s.perProject["/a"].providerId).toBe("claude-oauth");
  });
  test("resetState returns an empty state", () => {
    const s = resetState();
    expect(s).toEqual(empty());
  });
});

describe("countTints", () => {
  test("returns zero when no tints are set", () => {
    expect(countTints(empty())).toBe(0);
  });
  test("counts only entries with a color", () => {
    const s: State = {
      ...empty(),
      perProject: {
        "/a": { color: "#8b4a3a" },
        "/b": { providerId: "claude-oauth" },
        "/c": { color: "#3a6a8b" },
      },
    };
    expect(countTints(s)).toBe(2);
  });
});

describe("setProjectTracking", () => {
  test("turns tracking on preserving other per-project fields", () => {
    const s = setProjectTracking(
      { ...empty(), perProject: { "/a": { color: "#8b4a3a" } } },
      "/a",
      true,
    );
    expect(s.perProject["/a"].track).toBe(true);
    expect(s.perProject["/a"].color).toBe("#8b4a3a");
  });
  test("turns tracking off", () => {
    const s = setProjectTracking(
      { ...empty(), perProject: { "/a": { track: true } } },
      "/a",
      false,
    );
    expect(s.perProject["/a"].track).toBe(false);
  });
});
