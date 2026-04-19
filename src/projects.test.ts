import { describe, test, expect } from "bun:test";
import { fuzzyFilter, projectDisplay, type Project } from "./projects.ts";

const p = (parent: string, name: string): Project => ({
  parent,
  name,
  path: `/${parent}/${name}`,
});

const projects: Project[] = [
  p("GitHub", "earthflix"),
  p("GitHub", "ghostcode"),
  p("GitHub", "flykit"),
  p("Sandbox", "earthflix"),
  p("Sandbox", "scratch"),
];

describe("projectDisplay", () => {
  test("renders parent/name", () => {
    expect(projectDisplay(p("GitHub", "ghostcode"))).toBe("GitHub/ghostcode");
  });
});

describe("fuzzyFilter", () => {
  test("returns all projects for empty query", () => {
    expect(fuzzyFilter(projects, "")).toEqual(projects);
  });
  test("exact name match wins", () => {
    const result = fuzzyFilter(projects, "ghostcode");
    expect(result[0].name).toBe("ghostcode");
  });
  test("prefix match beats substring match", () => {
    const result = fuzzyFilter(projects, "ear");
    expect(result[0].name).toBe("earthflix");
  });
  test("case-insensitive", () => {
    const result = fuzzyFilter(projects, "GHOST");
    expect(result.some((r) => r.name === "ghostcode")).toBe(true);
  });
  test("matches on parent/name path", () => {
    const result = fuzzyFilter(projects, "sandbox/scratch");
    expect(result[0].name).toBe("scratch");
  });
  test("subsequence match across path", () => {
    const result = fuzzyFilter(projects, "ghc");
    expect(result.some((r) => r.name === "ghostcode")).toBe(true);
  });
  test("no match returns empty array", () => {
    expect(fuzzyFilter(projects, "zzzzznone")).toEqual([]);
  });
});
