import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  resolveDefaultConfigCandidates,
  resolveConfigPath,
  resolveOAuthDir,
  resolveOAuthPath,
  resolveStateDir,
} from "./paths.js";

describe("oauth paths", () => {
  it("prefers OPENPAW_OAUTH_DIR over OPENPAW_STATE_DIR", () => {
    const env = {
      OPENPAW_OAUTH_DIR: "/custom/oauth",
      OPENPAW_STATE_DIR: "/custom/state",
    } as NodeJS.ProcessEnv;

    expect(resolveOAuthDir(env, "/custom/state")).toBe(path.resolve("/custom/oauth"));
    expect(resolveOAuthPath(env, "/custom/state")).toBe(
      path.join(path.resolve("/custom/oauth"), "oauth.json"),
    );
  });

  it("derives oauth path from OPENPAW_STATE_DIR when unset", () => {
    const env = {
      OPENPAW_STATE_DIR: "/custom/state",
    } as NodeJS.ProcessEnv;

    expect(resolveOAuthDir(env, "/custom/state")).toBe(path.join("/custom/state", "credentials"));
    expect(resolveOAuthPath(env, "/custom/state")).toBe(
      path.join("/custom/state", "credentials", "oauth.json"),
    );
  });
});

describe("state + config path candidates", () => {
  it("uses OPENPAW_STATE_DIR when set", () => {
    const env = {
      OPENPAW_STATE_DIR: "/new/state",
    } as NodeJS.ProcessEnv;

    expect(resolveStateDir(env, () => "/home/test")).toBe(path.resolve("/new/state"));
  });

  it("orders default config candidates in a stable order", () => {
    const home = "/home/test";
    const candidates = resolveDefaultConfigCandidates({} as NodeJS.ProcessEnv, () => home);
    const expected = [
      path.join(home, ".openpaw", "openpaw.json"),
      path.join(home, ".openpaw", "clawdbot.json"),
      path.join(home, ".openpaw", "moltbot.json"),
      path.join(home, ".openpaw", "moldbot.json"),
      path.join(home, ".clawdbot", "openpaw.json"),
      path.join(home, ".clawdbot", "clawdbot.json"),
      path.join(home, ".clawdbot", "moltbot.json"),
      path.join(home, ".clawdbot", "moldbot.json"),
      path.join(home, ".moltbot", "openpaw.json"),
      path.join(home, ".moltbot", "clawdbot.json"),
      path.join(home, ".moltbot", "moltbot.json"),
      path.join(home, ".moltbot", "moldbot.json"),
      path.join(home, ".moldbot", "openpaw.json"),
      path.join(home, ".moldbot", "clawdbot.json"),
      path.join(home, ".moldbot", "moltbot.json"),
      path.join(home, ".moldbot", "moldbot.json"),
    ];
    expect(candidates).toEqual(expected);
  });

  it("prefers ~/.openpaw when it exists and legacy dir is missing", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "openpaw-state-"));
    try {
      const newDir = path.join(root, ".openpaw");
      await fs.mkdir(newDir, { recursive: true });
      const resolved = resolveStateDir({} as NodeJS.ProcessEnv, () => root);
      expect(resolved).toBe(newDir);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("CONFIG_PATH prefers existing config when present", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "openpaw-config-"));
    const previousHome = process.env.HOME;
    const previousUserProfile = process.env.USERPROFILE;
    const previousHomeDrive = process.env.HOMEDRIVE;
    const previousHomePath = process.env.HOMEPATH;
    const previousOpenPawConfig = process.env.OPENPAW_CONFIG_PATH;
    const previousOpenPawState = process.env.OPENPAW_STATE_DIR;
    try {
      const legacyDir = path.join(root, ".openpaw");
      await fs.mkdir(legacyDir, { recursive: true });
      const legacyPath = path.join(legacyDir, "openpaw.json");
      await fs.writeFile(legacyPath, "{}", "utf-8");

      process.env.HOME = root;
      if (process.platform === "win32") {
        process.env.USERPROFILE = root;
        const parsed = path.win32.parse(root);
        process.env.HOMEDRIVE = parsed.root.replace(/\\$/, "");
        process.env.HOMEPATH = root.slice(parsed.root.length - 1);
      }
      delete process.env.OPENPAW_CONFIG_PATH;
      delete process.env.OPENPAW_STATE_DIR;

      vi.resetModules();
      const { CONFIG_PATH } = await import("./paths.js");
      expect(CONFIG_PATH).toBe(legacyPath);
    } finally {
      if (previousHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = previousHome;
      }
      if (previousUserProfile === undefined) {
        delete process.env.USERPROFILE;
      } else {
        process.env.USERPROFILE = previousUserProfile;
      }
      if (previousHomeDrive === undefined) {
        delete process.env.HOMEDRIVE;
      } else {
        process.env.HOMEDRIVE = previousHomeDrive;
      }
      if (previousHomePath === undefined) {
        delete process.env.HOMEPATH;
      } else {
        process.env.HOMEPATH = previousHomePath;
      }
      if (previousOpenPawConfig === undefined) {
        delete process.env.OPENPAW_CONFIG_PATH;
      } else {
        process.env.OPENPAW_CONFIG_PATH = previousOpenPawConfig;
      }
      if (previousOpenPawConfig === undefined) {
        delete process.env.OPENPAW_CONFIG_PATH;
      } else {
        process.env.OPENPAW_CONFIG_PATH = previousOpenPawConfig;
      }
      if (previousOpenPawState === undefined) {
        delete process.env.OPENPAW_STATE_DIR;
      } else {
        process.env.OPENPAW_STATE_DIR = previousOpenPawState;
      }
      if (previousOpenPawState === undefined) {
        delete process.env.OPENPAW_STATE_DIR;
      } else {
        process.env.OPENPAW_STATE_DIR = previousOpenPawState;
      }
      await fs.rm(root, { recursive: true, force: true });
      vi.resetModules();
    }
  });

  it("respects state dir overrides when config is missing", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "openpaw-config-override-"));
    try {
      const legacyDir = path.join(root, ".openpaw");
      await fs.mkdir(legacyDir, { recursive: true });
      const legacyConfig = path.join(legacyDir, "openpaw.json");
      await fs.writeFile(legacyConfig, "{}", "utf-8");

      const overrideDir = path.join(root, "override");
      const env = { OPENPAW_STATE_DIR: overrideDir } as NodeJS.ProcessEnv;
      const resolved = resolveConfigPath(env, overrideDir, () => root);
      expect(resolved).toBe(path.join(overrideDir, "openpaw.json"));
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
