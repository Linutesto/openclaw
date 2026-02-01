import { describe, expect, it } from "vitest";
import {
  buildParseArgv,
  getFlagValue,
  getCommandPath,
  getPrimaryCommand,
  getPositiveIntFlagValue,
  getVerboseFlag,
  hasHelpOrVersion,
  hasFlag,
  shouldMigrateState,
  shouldMigrateStateFromPath,
} from "./argv.js";

describe("argv helpers", () => {
  it("detects help/version flags", () => {
    expect(hasHelpOrVersion(["node", "openpaw", "--help"])).toBe(true);
    expect(hasHelpOrVersion(["node", "openpaw", "-V"])).toBe(true);
    expect(hasHelpOrVersion(["node", "openpaw", "status"])).toBe(false);
  });

  it("extracts command path ignoring flags and terminator", () => {
    expect(getCommandPath(["node", "openpaw", "status", "--json"], 2)).toEqual(["status"]);
    expect(getCommandPath(["node", "openpaw", "agents", "list"], 2)).toEqual(["agents", "list"]);
    expect(getCommandPath(["node", "openpaw", "status", "--", "ignored"], 2)).toEqual(["status"]);
  });

  it("returns primary command", () => {
    expect(getPrimaryCommand(["node", "openpaw", "agents", "list"])).toBe("agents");
    expect(getPrimaryCommand(["node", "openpaw"])).toBeNull();
  });

  it("parses boolean flags and ignores terminator", () => {
    expect(hasFlag(["node", "openpaw", "status", "--json"], "--json")).toBe(true);
    expect(hasFlag(["node", "openpaw", "--", "--json"], "--json")).toBe(false);
  });

  it("extracts flag values with equals and missing values", () => {
    expect(getFlagValue(["node", "openpaw", "status", "--timeout", "5000"], "--timeout")).toBe(
      "5000",
    );
    expect(getFlagValue(["node", "openpaw", "status", "--timeout=2500"], "--timeout")).toBe("2500");
    expect(getFlagValue(["node", "openpaw", "status", "--timeout"], "--timeout")).toBeNull();
    expect(getFlagValue(["node", "openpaw", "status", "--timeout", "--json"], "--timeout")).toBe(
      null,
    );
    expect(getFlagValue(["node", "openpaw", "--", "--timeout=99"], "--timeout")).toBeUndefined();
  });

  it("parses verbose flags", () => {
    expect(getVerboseFlag(["node", "openpaw", "status", "--verbose"])).toBe(true);
    expect(getVerboseFlag(["node", "openpaw", "status", "--debug"])).toBe(false);
    expect(getVerboseFlag(["node", "openpaw", "status", "--debug"], { includeDebug: true })).toBe(
      true,
    );
  });

  it("parses positive integer flag values", () => {
    expect(getPositiveIntFlagValue(["node", "openpaw", "status"], "--timeout")).toBeUndefined();
    expect(
      getPositiveIntFlagValue(["node", "openpaw", "status", "--timeout"], "--timeout"),
    ).toBeNull();
    expect(
      getPositiveIntFlagValue(["node", "openpaw", "status", "--timeout", "5000"], "--timeout"),
    ).toBe(5000);
    expect(
      getPositiveIntFlagValue(["node", "openpaw", "status", "--timeout", "nope"], "--timeout"),
    ).toBeUndefined();
  });

  it("builds parse argv from raw args", () => {
    const nodeArgv = buildParseArgv({
      programName: "openpaw",
      rawArgs: ["node", "openpaw", "status"],
    });
    expect(nodeArgv).toEqual(["node", "openpaw", "status"]);

    const versionedNodeArgv = buildParseArgv({
      programName: "openpaw",
      rawArgs: ["node-22", "openpaw", "status"],
    });
    expect(versionedNodeArgv).toEqual(["node-22", "openpaw", "status"]);

    const versionedNodeWindowsArgv = buildParseArgv({
      programName: "openpaw",
      rawArgs: ["node-22.2.0.exe", "openpaw", "status"],
    });
    expect(versionedNodeWindowsArgv).toEqual(["node-22.2.0.exe", "openpaw", "status"]);

    const versionedNodePatchlessArgv = buildParseArgv({
      programName: "openpaw",
      rawArgs: ["node-22.2", "openpaw", "status"],
    });
    expect(versionedNodePatchlessArgv).toEqual(["node-22.2", "openpaw", "status"]);

    const versionedNodeWindowsPatchlessArgv = buildParseArgv({
      programName: "openpaw",
      rawArgs: ["node-22.2.exe", "openpaw", "status"],
    });
    expect(versionedNodeWindowsPatchlessArgv).toEqual(["node-22.2.exe", "openpaw", "status"]);

    const versionedNodeWithPathArgv = buildParseArgv({
      programName: "openpaw",
      rawArgs: ["/usr/bin/node-22.2.0", "openpaw", "status"],
    });
    expect(versionedNodeWithPathArgv).toEqual(["/usr/bin/node-22.2.0", "openpaw", "status"]);

    const nodejsArgv = buildParseArgv({
      programName: "openpaw",
      rawArgs: ["nodejs", "openpaw", "status"],
    });
    expect(nodejsArgv).toEqual(["nodejs", "openpaw", "status"]);

    const nonVersionedNodeArgv = buildParseArgv({
      programName: "openpaw",
      rawArgs: ["node-dev", "openpaw", "status"],
    });
    expect(nonVersionedNodeArgv).toEqual(["node", "openpaw", "node-dev", "openpaw", "status"]);

    const directArgv = buildParseArgv({
      programName: "openpaw",
      rawArgs: ["openpaw", "status"],
    });
    expect(directArgv).toEqual(["node", "openpaw", "status"]);

    const bunArgv = buildParseArgv({
      programName: "openpaw",
      rawArgs: ["bun", "src/entry.ts", "status"],
    });
    expect(bunArgv).toEqual(["bun", "src/entry.ts", "status"]);
  });

  it("builds parse argv from fallback args", () => {
    const fallbackArgv = buildParseArgv({
      programName: "openpaw",
      fallbackArgv: ["status"],
    });
    expect(fallbackArgv).toEqual(["node", "openpaw", "status"]);
  });

  it("decides when to migrate state", () => {
    expect(shouldMigrateState(["node", "openpaw", "status"])).toBe(false);
    expect(shouldMigrateState(["node", "openpaw", "health"])).toBe(false);
    expect(shouldMigrateState(["node", "openpaw", "sessions"])).toBe(false);
    expect(shouldMigrateState(["node", "openpaw", "memory", "status"])).toBe(false);
    expect(shouldMigrateState(["node", "openpaw", "agent", "--message", "hi"])).toBe(false);
    expect(shouldMigrateState(["node", "openpaw", "agents", "list"])).toBe(true);
    expect(shouldMigrateState(["node", "openpaw", "message", "send"])).toBe(true);
  });

  it("reuses command path for migrate state decisions", () => {
    expect(shouldMigrateStateFromPath(["status"])).toBe(false);
    expect(shouldMigrateStateFromPath(["agents", "list"])).toBe(true);
  });
});
