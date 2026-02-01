---
summary: "CLI reference for `openpaw plugins` (list, install, enable/disable, doctor)"
read_when:
  - You want to install or manage in-process Gateway plugins
  - You want to debug plugin load failures
title: "plugins"
---

# `openpaw plugins`

Manage Gateway plugins/extensions (loaded in-process).

Related:

- Plugin system: [Plugins](/plugin)
- Plugin manifest + schema: [Plugin manifest](/plugins/manifest)
- Security hardening: [Security](/gateway/security)

## Commands

```bash
openpaw plugins list
openpaw plugins info <id>
openpaw plugins enable <id>
openpaw plugins disable <id>
openpaw plugins doctor
openpaw plugins update <id>
openpaw plugins update --all
```

Bundled plugins ship with OpenPaw but start disabled. Use `plugins enable` to
activate them.

All plugins must ship a `openpaw.plugin.json` file with an inline JSON Schema
(`configSchema`, even if empty). Missing/invalid manifests or schemas prevent
the plugin from loading and fail config validation.

### Install

```bash
openpaw plugins install <path-or-spec>
```

Security note: treat plugin installs like running code. Prefer pinned versions.

Supported archives: `.zip`, `.tgz`, `.tar.gz`, `.tar`.

Use `--link` to avoid copying a local directory (adds to `plugins.load.paths`):

```bash
openpaw plugins install -l ./my-plugin
```

### Update

```bash
openpaw plugins update <id>
openpaw plugins update --all
openpaw plugins update <id> --dry-run
```

Updates only apply to plugins installed from npm (tracked in `plugins.installs`).
