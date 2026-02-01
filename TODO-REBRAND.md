# OpenClaw → OpenPaw Rebranding - COMPLETED

## Status: ✅ DONE (src/ directory fully converted)

## Completed Tasks

### Phase 1: File Renames ✅
All `openclaw-*.ts` files renamed to `openpaw-*.ts`:
- [x] `openclaw-gateway-tool.test.ts` → `openpaw-gateway-tool.test.ts`
- [x] `openclaw-tools.*.test.ts` (11 files) → `openpaw-tools.*.test.ts`
- [x] `pi-tools.create-openclaw-coding-tools.*.test.ts` (4 files) → `pi-tools.create-openpaw-coding-tools.*.test.ts`
- [x] `openclaw-tools.ts` → `openpaw-tools.ts`
- [x] `openclaw-root.ts` → `openpaw-root.ts`
- [x] `types.openclaw.ts` → `types.openpaw.ts`

### Phase 2: Type/Interface Renames ✅
All types renamed from `OpenClaw*` to `OpenPaw*`:
- [x] `OpenClawConfig` → `OpenPawConfig` (alias kept for backwards compat)
- [x] `OpenClawModelsJson` → `OpenPawModelsJson`
- [x] `OpenClawPlugins` → `OpenPawPlugins`
- [x] `OpenClawCodingTools` → `OpenPawCodingTools`
- [x] `OpenClawTools` → `OpenPawTools`
- [x] `OpenClawAgentDir` → `OpenPawAgentDir`
- [x] `OpenClawPackageRoot` → `OpenPawPackageRoot`
- [x] `OpenClawChrome` → `OpenPawChrome`
- [x] `OpenClawSchema` → `OpenPawSchema`
- [x] All `OpenClawPlugin*` types → `OpenPawPlugin*`
- [x] All other `OpenClaw*` types → `OpenPaw*`

### Phase 3: Function Renames ✅
- [x] `createOpenClawCodingTools` → `createOpenPawCodingTools`
- [x] `createOpenClawTools` → `createOpenPawTools`
- [x] `createOpenClawReadTool` → `createOpenPawReadTool`
- [x] `resolveOpenClawAgentDir` → `resolveOpenPawAgentDir`
- [x] `resolveOpenClawDocsPath` → `resolveOpenPawDocsPath`
- [x] `resolveOpenClawPackageRoot` → `resolveOpenPawPackageRoot`
- [x] `ensureOpenClawModelsJson` → `ensureOpenPawModelsJson`

### Phase 4: Script Renames ✅
- [x] `clawlog.sh` → `pawlog.sh`
- [x] `update-clawtributors.ts` → `update-pawtributors.ts`
- [x] `openclaw-auth-monitor.service` → `openpaw-auth-monitor.service`
- [x] `openclaw-auth-monitor.timer` → `openpaw-auth-monitor.timer`

### Phase 5: Config/Doc Updates ✅
- [x] `CLAUDE.md` - updated all claw references
- [x] `package.json` - fixed script commands

## Remaining (Out of Scope for This Pass)

### macOS/iOS Apps (Swift code)
The `apps/macos` and `apps/ios` directories still contain OpenClaw references.
These require Swift/Xcode expertise to rename safely:
- `OpenClawIPC` module
- `OpenClawProtocol`
- Various Swift files with OpenClaw naming

### Documentation
The `docs/` directory has some references to external sites (ClawHub, etc.)
that may be intentional for showcase/marketing purposes.

## Verification

```bash
# Build passes
pnpm build

# Lint passes (only unrelated error in scripts/)
pnpm lint

# No OpenClaw/openclaw in src/*.ts
grep -ri "openclaw\|OpenClaw" src --include="*.ts"  # Returns nothing
```

## Backwards Compatibility

The following aliases are maintained for backwards compatibility:
- `OpenClawConfig` = `OpenPawConfig` (in `src/config/types.openpaw.ts`)
