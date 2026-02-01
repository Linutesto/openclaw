import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveGatewayStateDir } from "./paths.js";

describe("resolveGatewayStateDir", () => {
  it("uses the default state dir when no overrides are set", () => {
    const env = { HOME: "/Users/test" };
    expect(resolveGatewayStateDir(env)).toBe(path.join("/Users/test", ".openpaw"));
  });

  it("appends the profile suffix when set", () => {
    const env = { HOME: "/Users/test", OPENPAW_PROFILE: "rescue" };
    expect(resolveGatewayStateDir(env)).toBe(path.join("/Users/test", ".openpaw-rescue"));
  });

  it("treats default profiles as the base state dir", () => {
    const env = { HOME: "/Users/test", OPENPAW_PROFILE: "Default" };
    expect(resolveGatewayStateDir(env)).toBe(path.join("/Users/test", ".openpaw"));
  });

  it("uses OPENPAW_STATE_DIR when provided", () => {
    const env = { HOME: "/Users/test", OPENPAW_STATE_DIR: "/var/lib/openpaw" };
    expect(resolveGatewayStateDir(env)).toBe(path.resolve("/var/lib/openpaw"));
  });

  it("expands ~ in OPENPAW_STATE_DIR", () => {
    const env = { HOME: "/Users/test", OPENPAW_STATE_DIR: "~/openpaw-state" };
    expect(resolveGatewayStateDir(env)).toBe(path.resolve("/Users/test/openpaw-state"));
  });

  it("preserves Windows absolute paths without HOME", () => {
    const env = { OPENPAW_STATE_DIR: "C:\\State\\openpaw" };
    expect(resolveGatewayStateDir(env)).toBe("C:\\State\\openpaw");
  });
});
