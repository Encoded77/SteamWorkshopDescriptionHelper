# SteamWorkshopDescriptionHelper

Generates branded PNG blocks for Steam Workshop descriptions, so complex mods
can be explained past Steam's 8000 character limit.

Everything runs in Docker. Nothing needs to be installed on the host except
Docker Desktop with the WSL2 backend.

## What to put in an image, and what to leave as text

Moving text into a PNG buys characters but costs real things:

- **Steam indexes description text for search.** Anything inside an image stops
  matching workshop queries.
- **Non-English users cannot machine-translate an image.**
- **Every typo means regenerating and re-uploading.**

So: images carry explanation and visual showcase. Real text keeps what people
search for and what changes often — compatibility, load order, known issues,
changelog.

The design is dense because a description has a hard character budget and every
image competes for room in it. Prefer fewer, fuller images over many small ones.

## Setup

This tool holds no mod content. Material lives in a separate **workshop-assets**
repo, one folder per mod, mounted at `/workspace`:

```
workshop-assets/            <- public repo, served by jsDelivr
  swdh.workspace.json       <- {"repo": "you/workshop-assets", "branch": "main"}
  RimworldRebalancePatches/
    content/                one YAML file per generated image
    description/            description.txt and urls.yaml
    assets/                 source icons and screenshots
    out/                    rendered PNGs
```

Copy `.env.example` to `.env` and fill in:

- `SWDH_WORKSPACE` — path to that repo (defaults to `../workshop-assets`)
- `SWDH_PROJECT` — which mod folder to work on
- `GITHUB_TOKEN` — fine-grained token with **Contents: Read and write on that one
  repo**, nothing else. Used only for publishing; never written to disk or logs.
- `SWDH_MODS` — optional, the folder holding your RimWorld mods, so a preview
  render can be written to `<Mod>/About/Preview.png`. Leave it unset and that
  action stays disabled — nothing outside the workspace is mounted.

## Commands

```powershell
# Point the workspace at the repo that publishes its assets
docker compose run --rm swdh link https://github.com/you/YourAssetsRepo.git

# Visual editor at http://localhost:5173
docker compose run --rm --service-ports swdh dev

# Render every content/*.yaml to out/
docker compose run --rm swdh build

# Commit rendered PNGs to the assets repo and pin jsDelivr URLs to that commit
docker compose run --rm swdh publish

# Assemble the description and report the character budget
docker compose run --rm swdh bbcode

# Design system specimen sheet, and stand-in screenshots
docker compose run --rm swdh identity
docker compose run --rm swdh fixtures
```

Add `--project <name>` when the workspace holds more than one mod. With several
projects and no `--project`, commands refuse rather than guess — publishing to
the wrong mod would be hard to notice.

The editor switches project from a dropdown in its navbar, so `SWDH_PROJECT` is
only the initial default there.

`link` accepts a browser URL, an HTTPS or SSH clone URL, or bare `owner/name`,
and writes `swdh.workspace.json`. With `GITHUB_TOKEN` set it also checks that
the repo exists, that the token can push, and that the repo is public — jsDelivr
cannot serve a private one.

**If `link` warns that the workspace has no projects, stop and check
`SWDH_WORKSPACE`.** docker-compose creates a bind-mount source directory when it
is missing, so a stale path produces a silently empty workspace rather than an
error.

## The editor

`swdh dev` serves a visual editor at <http://localhost:5173>. Vite runs in
middleware mode inside the same server, so the UI and the API share one origin
and one port — there is no separate build step or dev server to start.

- **Images** — browse and create content files, edit them in forms, and see a
  live preview beside them.
- **Description** — write `description.txt`, insert `{{image:name}}`
  placeholders, fill in image URLs, and watch the character budget.
- **Publish** — see what is published, push to the CDN, and write a preview
  render to a mod's `About/Preview.png`.
- **Output** — render every PNG and read the result.

**YAML files remain the source of truth.** The editor reads and writes
`content/*.yaml` in place rather than keeping its own store, so the CLI, git
diffs, and anything generated for you all keep working. Saves apply edits to the
parsed document tree, so comments, key order, and block scalars survive a
round-trip — a comment you wrote is not destroyed the first time the GUI touches
the file.

**The preview is not a reimplementation.** The iframe is filled with the exact
HTML the exporter rasterizes, fetched from the server. There is only one
implementation of the design system, so the preview cannot drift from the
output.

### Annotation editing

The reason the GUI exists. Open an image with annotations and press
**Draw regions**: drag on the screenshot to create a highlight, drag to move it,
use the corner handle to resize, or nudge with the arrow keys for targets a drag
cannot hit exactly. Coordinates are kept in source-image pixels — the same units
the file stores — and clamped to the image, which makes the build's
out-of-bounds error unreachable from the editor.

### Editing outside the editor

Changes on disk are pushed to the browser over SSE, so files edited in a text
editor or generated for you appear without a refresh. Note that `src/` changes
require restarting `swdh dev`: Vite's hot reload covers the editor UI, not the
Node server.

## Workflow

1. Author images in the editor (`swdh dev`), or write `content/*.yaml` directly.
2. **Render PNGs** once the design is settled.
3. **Publish** — commits the PNGs to the assets repo and rewrites `urls.yaml`
   and `out/description.bbcode` with jsDelivr URLs.
4. Paste `out/description.bbcode` into Steam.
5. For the mod preview, export a `preview-*` render to `<Mod>/About/Preview.png`
   and let RimWorld's in-game uploader publish it. That one never touches a CDN.

`bbcode` exits non-zero if any placeholder is unresolved or the description is
over the limit, so broken output cannot be pasted unnoticed.

## Hosting

Images are served from your own public repo through **jsDelivr**:

```
https://cdn.jsdelivr.net/gh/<owner>/<repo>@<commit-sha>/<Mod>/out/<name>.png
```

**Why not an image host.** Imgur geoblocked the UK in September 2025 rather than
comply with the Online Safety Act, silently breaking embedded images for a slice
of every audience. That is a regulatory risk shared by every consumer UGC image
host, so picking a different one relocates the risk instead of removing it. The
alternatives have their own problems: Catbox files can expire and sit behind no
CDN, ImgBB takes an irrevocable commercial licence on what you upload,
Postimages asks for a link back, and Imgur's terms forbid hotlinking anyway.

A repo on a developer CDN has no expiry, no hotlink restriction, and no
age-verification regime to run from. jsDelivr fronts it with Cloudflare and
Fastly, failing over between them, with no bandwidth limits.

**URLs are pinned to a commit SHA, not a branch.** Each URL is therefore
immutable, so jsDelivr's caching can never serve something stale and a published
description keeps pointing at exactly the image it was written against. It is
also why publishing is inherently two steps: the commit must exist before its
SHA can appear in `urls.yaml`.

### What gets published

The whole project folder, not just its renders. Sources travel with their
output — publishing only the PNGs left the repo holding images whose content
files, screenshots and theme were months out of date.

Membership is decided by git, via `ls-files --cached --others
--exclude-standard`: tracked files plus untracked ones `.gitignore` does not
exclude. That way the repo's own ignore rules decide what counts as project
material, rather than a second list here that would drift from them.

Publishing is a **mirror**. A file the repo still holds under the project that
no longer exists on disk is deleted, which is how a removed content file reaches
the repo. Deletions are confined to the project's own path prefix.

The one departure from a literal mirror is `out/`, which is filtered against the
content files rather than taken as found. A render whose content file was
deleted or renamed is not published, and is removed from the repo if it is
already there — a binary committed by accident stays in git history permanently.
It is left alone on disk; only the repo copy goes. Nested paths like
`out/identity/` are exempt, having no content file by design.

The two generated files are held back into a second commit, because both embed
the SHA of the first one and cannot be part of it.

Run `publish --dry-run` to see the plan — every update and every deletion —
without writing anything.

### The clone has to be current

Publishing writes through the GitHub API, so for every path it touches the local
file wins, and a mirror can delete. If the clone were behind, publishing would
silently undo whatever the commits it has not seen had changed.

So publish refuses unless the clone sits on the same commit as the branch, and
says whether to pull or push. Uncommitted changes are fine and expected — that
is the point — it is the commit underneath them that has to match.

Each publish makes one or two commits, which puts the clone behind again. Every
project file on disk already matches what was committed, so catching up discards
nothing:

```bash
git -C <workspace> checkout -- <Mod>
git -C <workspace> pull
```

That is only true straight after a publish. With local edits you have not
published yet, `checkout` would throw them away — move HEAD instead and keep the
working tree:

```bash
git -C <workspace> fetch origin
git -C <workspace> reset --mixed origin/<branch>
```

## Content schema

One YAML file per image, in `content/`. The filename (without extension) is the
image name used by `{{image:name}}` placeholders and `urls.yaml`.

Unknown keys are a hard error, so a typo fails loudly rather than being ignored.

### Banner

Section heading placed before text that stays in the description.

```yaml
type: banner
title: Features
kicker: Rebalance Patches   # optional, right-aligned monospace
```

### Block

Explanatory body content.

```yaml
type: block
title: Compatibility First   # optional
body:
  - p: Paragraph with **bold** and _highlighted_ text.
  - list:
      - First item.
      - Second item.
  - image:
      src: assets/screenshots/example.png
      caption: Optional caption.   # optional
```

### Card

A block with a fixed square icon slot at the top left, for explaining a feature
set tied to a DLC or mod.

```yaml
type: card
title: Mechanoid Rework
eyebrow: Requires Biotech    # optional, small accent line above the title
icon: assets/icons/biotech.png
body:
  - p: Body content, same item types as a block.
```

### Annotated screenshots

Highlight a region and attach a short label. The highlighted area stays at full
brightness while the rest of the screenshot is dimmed — the dimming does most of
the directing, since the eye finds the undimmed patch before it finds an outline.

```yaml
- image:
    src: assets/screenshots/worktab.png
    caption: Work tab with a locked priority cell.
    annotations:
      - x: 242          # source-image pixels, read straight off the file
        y: 94
        width: 34
        height: 30
        text: Locked by another mod
        side: right     # top | right | bottom | left — defaults to right
        at:             # optional: place the label anywhere in the image
          x: 470
          y: 320
```

**Crop tight first.** A detail like a single work-tab cell, inside a full 1920px
screenshot scaled into the 598px column, ends up about four pixels across. No
highlight rescues a target that small. Annotations are for pointing at things
that are already legible.

**Coordinates are source-image pixels**, resolved against the file's real
dimensions read from its header. That means annotated images must be PNG or
JPEG, and that replacing a screenshot with a differently-sized export
invalidates every coordinate in it.

**Labels are placed explicitly, not auto-laid-out.** A constraint solver would
shift every label whenever one string changed. Instead, `side` is yours to
choose, and the build fails if a label spills off the image or two labels
overlap — telling you which ones, by their text.

Left to itself, a label pins to the `side` border and centres on its highlight,
which is what makes two highlights at a similar height collide. `at` places it
anywhere in the image instead — absolute source-image pixels, the same frame as
`x`/`y`/`width`/`height`, so a position read off the screenshot means the same
thing everywhere. Both axes are free, so a label can sit in open space nowhere
near a border, and several can be stacked in one clear patch.

`at` is the point the leader *touches*, not a corner of the label, and the label
grows away from it. That is why the leader always meets the label no matter what
the text does to its width: nothing has to predict its size.

`side` is not "which border it pins to" any more — it is which face of the
highlight the leader leaves by, and so which face of the label it enters. A
placed label must lie beyond that face, or the elbow would double back across
the highlight it is pointing at; the build says so by name if it doesn't. In the
editor the side turns to follow the label if you drag it past the region, and
sides the label cannot be reached from are disabled rather than left to fail
later.

The leader runs out of the highlight perpendicular to its face, along to the
label, then in — every segment axis-aligned, collapsing to a single line when
the two already line up. The stub before the turn is 3% of the dimension it
crosses rather than a fixed pixel count, so the elbow holds its shape at any
render size, and it is clamped so it never overshoots a label sitting close by.

### Inline formatting

A small subset, not full Markdown:

- `**bold**` renders bold in the primary ink colour.
- `_highlight_` renders in the accent colour. It is a highlight, not an italic.

Both work in every text slot of every template — titles, kickers, eyebrows,
taglines, overlays, marks, captions, list items and callout labels included.

Emphasis is relative to what surrounds it, so a slot already set in the accent
(a card eyebrow, a preview kicker) highlights in bright ink instead, and a slot
already set in the brightest ink (any title, an overlay) bolds in the accent.
Either marker therefore always changes something, whatever slot it lands in.

Text is escaped before markers are expanded, so content can never inject markup.

## Preview images

RimWorld's `About/Preview.png` should be 16:9 and under 1MB, and the same file
serves both the in-game mod list and the Steam Workshop item. These render at
640×360 logical × 2 = exactly 1280×720.

Two things behave differently from description images:

**The canvas is fixed.** Description blocks flow to whatever height they need; a
preview cannot. Content that does not fit fails the build with the file name and
the overflow in pixels. Type is never auto-shrunk, since that would vary font
size per preview and break the consistency the design system exists to enforce.

**Type is sized for display, not canvas.** Previews are shown small in the mod
list and Steam's browse grid, so preview type is far larger than the description
scale. Keep overlay text to a few words; if it needs a sentence, it belongs in
the description.

**Oversized files are quantized automatically.** Anything over 1MB is passed
through `pngquant` at progressively wider quality ranges, stopping at the first
that fits, so a file only ever loses as much fidelity as it must. The build
reports when this happened — quantization can band gradients, and the identity's
amber is the most likely thing to show it. If no quality range gets under 1MB,
the build fails and you need a visually simpler screenshot.

### Title preview

```yaml
type: preview-title
name: Rebalance Patches
tagline: Compatibility-first tweaks, every patch individually toggleable.
kicker: RimWorld Mod    # optional, small monospace line
flag: "1.6"             # optional diagonal ribbon, top right
```

### Screenshot preview

```yaml
type: preview-screenshot
screenshot: assets/screenshots/colony.png
overlay: Mechanoid Rework   # optional, keep to a few words
fit: cover                  # cover | contain
crop: center                # center | top | bottom, applies to cover
flag: "1.6"
annotations: []             # same schema as block images
```

`crop` matters with `fit: cover`: screenshots are 16:9 and so is the canvas, so
the moment an overlay band is added the visible area is *wider* than 16:9 and the
screenshot must be cropped vertically. `crop` chooses which part survives.

Use **`fit: contain`** for a pre-cropped region — a menu, a panel, anything not
16:9. The whole image is letterboxed on the identity ground with the frame and
ticks around it, so nothing you deliberately cropped to isolate gets cropped
again.

Annotations require `fit: contain` and the build says so if you forget. Under
`cover` the image is cropped to fill the canvas, so coordinates would no longer
land where you placed them and a highlight could be cropped out entirely.

### Full-bleed preview

No crop conflict — the screenshot fills the canvas, with the identity carried by
the frame and an optional corner mark.

```yaml
type: preview-fullbleed
screenshot: assets/screenshots/colony.png
mark: Rebalance Patches   # optional bottom-left mark
crop: center
flag: "1.6"
```

### Test fixture

`assets/screenshots/placeholder.png` is a generated stand-in, gitignored because
it is ~1.8MB, and noisy enough to exercise the size limit and quantization path.
Recreate it with:

```powershell
docker compose run --rm --entrypoint npx swdh tsx src/make-placeholder.ts
```

## Design system

The identity is **Foundry**: Oxanium display, Barlow body, IBM Plex Mono labels;
amber accent with cyan reserved as a secondary signal; opaque near-black panels
with hard corners and corner ticks.

- `src/design/tokens.css` — every colour, size, and spacing value. **The single
  source of truth.** Templates never hardcode values; retune the identity here.
- `src/design/base.css` — the component layer. All three primitives share
  `.swdh-panel`, so edge treatment and ground are defined exactly once.
- `src/components.ts` — the three primitives as typed functions.

`swdh identity` renders a specimen sheet of all three primitives on Steam's page
background. Run it after any design change as a regression check.

## Rendering notes

Output is 630 logical pixels wide — Steam's description column width — rendered
at `deviceScaleFactor: 2` for a 1260px PNG that stays crisp on high-DPI displays
without Steam upscaling.

Fonts are inlined as base64 data URIs rather than loaded from disk. This means
no screenshot can race an unloaded font, and nothing resolves through
fontconfig, so host fonts cannot influence output. Combined with the pinned
`mcr.microsoft.com/playwright:v1.61.1-noble` base image and a committed
lockfile, renders stay byte-identical across machines and over time.

## Note on `dev` and file watching

The watcher polls (`usePolling`) because inotify events do not cross the
Windows-to-WSL2 bind mount boundary — native watching silently observes nothing.
Set `SWDH_POLL=0` only if running against a native Linux filesystem.
