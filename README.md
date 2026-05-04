# mycopunk-wiki-generator

Bun + TypeScript pipeline that pulls Mycopunk game-data dumps from
[`mycopunk-data.pages.dev`](https://mycopunk-data.pages.dev) and pushes
templated wiki content to [`mycopunk.miraheze.org`](https://mycopunk.miraheze.org).

Generates per-entity `/source` + skeleton wiki pages, hex-pattern SVGs, and
extracts icons from spritesheets. Uploads everything via the MediaWiki API.

## Setup

```bash
mise install      # bun + python (per mise.toml)
bun install       # devdeps (eslint, prettier, json2ts, sharp)
```

### Bot credentials

`MYCOPUNK_BOT_USER` and `MYCOPUNK_BOT_PASSWORD` either as environment
variables (preferred for CI) or in a `.local.env` file at the repo root:

```
MYCOPUNK_BOT_USER=YourUsername@botpassword-name
MYCOPUNK_BOT_PASSWORD=botpassword-secret
```

`.local.env` is gitignored. Env vars take precedence when both are set.

### Spritesheets (icon extraction only)

Icon-extraction tasks need the game's Unity textures unpacked at
`~/MycopunkExtracted/<version>/ExportedProject/Assets/Texture2D/`. Use
AssetStudio or UABEA against the installed game build. `<version>` is
resolved from `.dump-cache/current` automatically.

## Daily flow

```bash
mise run release:sync       # refresh .dump-cache/<version>.json + schema.json
mise run release            # regenerate every entity's wiki source + assets
mise run release:upload     # push to the wiki
```

The bot's `upload-wiki.ts` classifies each existing host page before
overwriting and prints a per-page action plan (create / update / skip /
flag-for-curator). Curator overrides live under `wiki-config/<entity>/`
(force-overwrite + preserved title lists, hand-edited).

Per-entity tasks are listed under `mise tasks ls` (e.g. `release:gears`,
`release:upload-skin-previews`).

## Layout

```
scripts/                    pipeline source
  shared/                   loaders, dump-cache, wiki-client
    entities/               per-entity context builders + upload configs
    upgrades/               relocated upgrade utils + types
    data/                   auto-generated schema.d.ts (json2ts target)
  templates/                eta templates (skeleton + /source per entity)
wiki-templates/             Portable Infobox bodies + templatestyles
                            (manually published to Template:* on the wiki)
wiki-config/                hand-edited curator overrides per entity
                            (force-overwrite-titles, preserved-titles)
generated-wiki-source/      gitignored regeneratable wiki output
generated-icons/            gitignored sprite extracts
generated-svgs/             gitignored hex pattern SVGs
.dump-cache/                gitignored versioned dumps + active pointer
mise.toml                   release task graph (the source of truth)
```

## Quality

```bash
bun run check     # tsc --noEmit
bun run lint      # prettier + eslint
bun test          # 878 stat-calculation tests against the active dump
bun run format    # prettier --write
```

Type-checking is on the entire `scripts/` tree, not just imports — adding new
files to `scripts/` automatically brings them in.

## Data flow

`scripts/sync-data.ts` writes `.dump-cache/<version>.json` and a one-line
`.dump-cache/current` pointer. Everything downstream funnels through
`readDump()` in `scripts/shared/dump.ts`, which follows the pointer.

`SCHEMA_CHANGES.md` documents the dump format and its migration history.
The active JSON schema is at `.dump-cache/schema.json` (refreshed every
sync); `bun run generate:types` regenerates `scripts/shared/data/schema.d.ts`
from it via `json-schema-to-typescript`.
