import path from "node:path";
import { describe, expect, it } from "vitest";
import { formatCliCommand } from "./command-format.js";
import { applyCliProfileEnv, parseCliProfileArgs } from "./profile.js";

describe("parseCliProfileArgs", () => {
  it("leaves gateway --dev for subcommands", () => {
    const res = parseCliProfileArgs([
      "node",
      "openpaw",
      "gateway",
      "--dev",
      "--allow-unconfigured",
    ]);
    if (!res.ok) {
      throw new Error(res.error);
    }
    expect(res.profile).toBeNull();
    expect(res.argv).toEqual(["node", "openpaw", "gateway", "--dev", "--allow-unconfigured"]);
  });

  it("still accepts global --dev before subcommand", () => {
    const res = parseCliProfileArgs(["node", "openpaw", "--dev", "gateway"]);
    if (!res.ok) {
      throw new Error(res.error);
    }
    expect(res.profile).toBe("dev");
    expect(res.argv).toEqual(["node", "openpaw", "gateway"]);
  });

  it("parses --profile value and strips it", () => {
    const res = parseCliProfileArgs(["node", "openpaw", "--profile", "work", "status"]);
    if (!res.ok) {
      throw new Error(res.error);
    }
    expect(res.profile).toBe("work");
    expect(res.argv).toEqual(["node", "openpaw", "status"]);
  });

  it("rejects missing profile value", () => {
    const res = parseCliProfileArgs(["node", "openpaw", "--profile"]);
    expect(res.ok).toBe(false);
  });

  it("rejects combining --dev with --profile (dev first)", () => {
    const res = parseCliProfileArgs(["node", "openpaw", "--dev", "--profile", "work", "status"]);
    expect(res.ok).toBe(false);
  });

  it("rejects combining --dev with --profile (profile first)", () => {
    const res = parseCliProfileArgs(["node", "openpaw", "--profile", "work", "--dev", "status"]);
    expect(res.ok).toBe(false);
  });
});

describe("applyCliProfileEnv", () => {
  it("fills env defaults for dev profile", () => {
    const env: Record<string, string | undefined> = {};
    applyCliProfileEnv({
      profile: "dev",
      env,
      homedir: () => "/home/peter",
    });
    const expectedStateDir = path.join("/home/peter", ".openpaw-dev");
    expect(env.OPENPAW_PROFILE).toBe("dev");
    expect(env.OPENPAW_STATE_DIR).toBe(expectedStateDir);
    expect(env.OPENPAW_CONFIG_PATH).toBe(path.join(expectedStateDir, "openpaw.json"));
    expect(env.OPENPAW_GATEWAY_PORT).toBe("19001");
  });

  it("does not override explicit env values", () => {
    const env: Record<string, string | undefined> = {
      OPENPAW_STATE_DIR: "/custom",
      OPENPAW_GATEWAY_PORT: "19099",
    };
    applyCliProfileEnv({
      profile: "dev",
      env,
      homedir: () => "/home/peter",
    });
    expect(env.OPENPAW_STATE_DIR).toBe("/custom");
    expect(env.OPENPAW_GATEWAY_PORT).toBe("19099");
    expect(env.OPENPAW_CONFIG_PATH).toBe(path.join("/custom", "openpaw.json"));
  });
});

describe("formatCliCommand", () => {
  it("returns command unchanged when no profile is set", () => {
    expect(formatCliCommand("openpaw doctor --fix", {})).toBe("openpaw doctor --fix");
  });

  it("returns command unchanged when profile is default", () => {
    expect(formatCliCommand("openpaw doctor --fix", { OPENPAW_PROFILE: "default" })).toBe(
      "openpaw doctor --fix",
    );
  });

  it("returns command unchanged when profile is Default (case-insensitive)", () => {
    expect(formatCliCommand("openpaw doctor --fix", { OPENPAW_PROFILE: "Default" })).toBe(
      "openpaw doctor --fix",
    );
  });

  it("returns command unchanged when profile is invalid", () => {
    expect(formatCliCommand("openpaw doctor --fix", { OPENPAW_PROFILE: "bad profile" })).toBe(
      "openpaw doctor --fix",
    );
  });

  it("returns command unchanged when --profile is already present", () => {
    expect(
      formatCliCommand("openpaw --profile work doctor --fix", { OPENPAW_PROFILE: "work" }),
    ).toBe("openpaw --profile work doctor --fix");
  });

  it("returns command unchanged when --dev is already present", () => {
    expect(formatCliCommand("openpaw --dev doctor", { OPENPAW_PROFILE: "dev" })).toBe(
      "openpaw --dev doctor",
    );
  });

  it("inserts --profile flag when profile is set", () => {
    expect(formatCliCommand("openpaw doctor --fix", { OPENPAW_PROFILE: "work" })).toBe(
      "openpaw --profile work doctor --fix",
    );
  });

  it("trims whitespace from profile", () => {
    expect(formatCliCommand("openpaw doctor --fix", { OPENPAW_PROFILE: "  jbopenclaw  " })).toBe(
      "openpaw --profile jbopenclaw doctor --fix",
    );
  });

  it("handles command with no args after openpaw", () => {
    expect(formatCliCommand("openpaw", { OPENPAW_PROFILE: "test" })).toBe("openpaw --profile test");
  });

  it("handles pnpm wrapper", () => {
    expect(formatCliCommand("pnpm openpaw doctor", { OPENPAW_PROFILE: "work" })).toBe(
      "pnpm openpaw --profile work doctor",
    );
  });
});
