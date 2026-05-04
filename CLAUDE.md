# CLAUDE.md

Guidance for Claude Code when working in this repo.

## What this is

A Bun + TypeScript pipeline that syncs Mycopunk game-data dumps and uploads
templated wiki content to `mycopunk.miraheze.org`. There is no frontend.
The release task graph in `mise.toml` is the source of truth for what runs
when — `package.json` only carries housekeeping scripts (`check`, `lint`,
`test`, `format`, `sync:data`, `generate:types`).

## Data flow

1. `scripts/sync-data.ts` (= `mise run release:sync`) downloads the active
   dump into `.dump-cache/<version>.json`, refreshes `.dump-cache/schema.json`,
   and writes the version string to `.dump-cache/current`.
2. Every consumer reads the dump via `readDump()` in `scripts/shared/dump.ts`,
   which follows the `current` pointer. The function is memoized — no script
   re-parses the JSON.
3. Per-entity loaders (`scripts/shared/load-<entity>.ts`) cross-reference the
   dump and return curated lists.
4. Per-entity context builders (`scripts/shared/entities/<entity>.ts`) feed
   eta templates in `scripts/templates/` to emit `/source` + skeleton pages
   into `generated-wiki-source/<entity>/` (gitignored — fully regeneratable).
5. Uploaders (`scripts/upload-wiki.ts --entity=<entity>`,
   `scripts/upload-files.ts --entity=<entity>`) push to the wiki via the
   MediaWiki API client in `scripts/shared/wiki-client.ts`. Curator
   overrides (force-overwrite + preserved title lists) live in
   `wiki-config/<entity>/` and are tracked.

## Pattern-A wiki layout

For most entities the bot owns a `<PageName>/source` page (auto-generated,
overwritten on every upload) with `<section>` markers; the human-curated host
page transcludes those sections via `{{#lst:.../source|sectionName}}`. This
lets the bot keep numerical fields fresh without trampling lore/trivia.
Skeleton pages are the bootstrap stubs uploaded only when no host page
exists yet.

## Entity registry

`scripts/shared/upload-pipeline.ts` defines `EntityUploadConfig<T>`. Each
entity ships an `<entity>-upload-config.ts` file that registers its
`pageTitle`, `safeFilename`, `loadItems`, classifier, and file-type list.
Adding a new entity is mostly: write a loader, write a context builder,
write an upload-config, register the templates, add a `release:<entity>`
task to `mise.toml`.

## Wiki templates

`wiki-templates/` holds Portable Infobox bodies (`.wiki`) and their
templatestyles (`.css`), one pair per entity. These are **not auto-uploaded**
— a curator pastes them into `Template:Infobox <entity>` on the wiki by
hand. Renames here therefore need a coordinated wiki-side action.

The legacy `Template_Upgrade_Infobox_v4.wiki` predates the `Infobox <entity>`
naming convention and lives at `wiki-templates/` under its original name to
match what's actually on the wiki.

## Bot credentials

`scripts/shared/wiki-client.ts` resolves credentials in this order:

1. Environment variables `MYCOPUNK_BOT_USER` and `MYCOPUNK_BOT_PASSWORD`
2. `.local.env` at the repo root (minimal `KEY=VALUE` dotenv: no quoting,
   no interpolation, `#` for comments)

`MYCOPUNK_BOT_USER` is the full bot login string (`Username@botname`).
`.local.env` is gitignored.

Smoke-test auth without uploading:

```bash
bun -e 'import { loginBot } from "./scripts/shared/wiki-client.ts"; import { getProjectRoot } from "./scripts/shared/paths.ts"; await loginBot(getProjectRoot(import.meta.url));'
```

## Commands

```bash
# Daily
mise run release:sync                # refresh .dump-cache/
mise run release                     # regenerate every entity
mise run release:upload              # push (classifier flags curator pages)

# Per-entity (substitute <entity>: upgrades, gears, characters, missions,
# enemies, threats, collectables, rarities, crafting, directives, skins,
# upgrade-presets, status-effects, resources)
mise run release:<entity>
mise run release:upload-<entity>

# Quality
bun run check     # tsc --noEmit on scripts/**
bun run lint      # prettier + eslint
bun test          # 878 stat-calculation tests
bun run format
```

## Testing

`scripts/shared/upgrades/utils.spec.ts` runs under `bun:test` (not vitest).
It loads the active dump and checks that every property's formatted stat
value falls inside its declared `[minValue, maxValue]` range. 2278
assertions across 878 generated tests. New stat-formatter behavior should
extend this spec.

## Conventions

- Switch active dump version: `printf vX.Y.Z > .dump-cache/current`. The
  cache retains every version that's ever been pulled — no re-download.
- Generators are deterministic against a fixed dump version (verified by
  running twice and comparing sha1s). Refactors that touch generation
  logic can be sanity-checked by re-running and diffing output.
- Scripts run on Bun. Import Node-style (`node:fs`, `node:path`); `Bun.*`
  globals are available but unused so far.
- Use `getProjectRoot(import.meta.url)` for absolute paths — the helper
  walks up to `package.json` and works regardless of caller depth.
- All generated output (`generated-wiki-source/`, `generated-icons/`,
  `generated-svgs/`) is gitignored; the bot's classifier handles
  curator-content protection at upload time. Hand-edited curator state
  (force-overwrite + preserved title lists) lives in `wiki-config/<entity>/`
  and IS tracked.
- The auto-generated `scripts/shared/data/schema.d.ts` is prettier-ignored
  and never hand-edited. If the upstream schema is missing a field that the
  dump actually carries (e.g. `MissionEntry.PlainName`), extend the type
  locally in the matching loader (`scripts/shared/load-missions.ts` does
  this) instead of patching the generated file.
