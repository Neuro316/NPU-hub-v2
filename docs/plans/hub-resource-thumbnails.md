# Resource Library thumbnails: plan

Branch `feat/resource-thumbnails` off `main` at `7270f0a`. No schema change.

**Packages** (approved 2026-11-04, pinned exact):
- `pdfjs-dist` 6.4.299 (Apache-2.0): renders a PDF's first page.
- `@napi-rs/canvas` 1.0.12 (MIT): the canvas pdfjs draws on, image scaling and WebP encoding.

pdfjs 6 lists `@napi-rs/canvas ^1.0.0` as its own optional dependency, so there is one copy.
Both are over two weeks old.

## What a file shows
| Type | Thumbnail |
|---|---|
| PDF | First page, rendered server-side |
| PNG, JPG, WebP, GIF | The image scaled down (GIF: first frame); never enlarged |
| DOCX, PPTX and anything else | A file-type tile (DOCX, PPTX, ...) in Hub colours |
| Any failure | The file-type tile |

- **Why DOCX and PPTX get a tile:** rendering their first page reliably server-side needs
  LibreOffice, which Vercel functions can't run. PPTX isn't an accepted upload type today
  anyway, but the tile covers it.
- **Size and storage:** 480 px wide WebP (quality 82), crisp in the 64 px list tile on
  retina screens, cropped at a 1:2 aspect. Stored beside the file in the private
  `hub-resources` bucket at `<storage path>.thumb.webp`.
  - No column records it: a file has a thumbnail when that object exists.
  - The list and the send panel get one-hour signed URLs.

## When it's made
- **Upload:** once the file is saved, the page calls `POST /api/resources/thumbnail
  {org_id, id}`, and the row shows "Generating preview" until it answers. The upload
  itself never waits on or fails because of the thumbnail.
- **Replace file** (new): the new file uploads to a new path, the resource points at it, and
  the thumbnail is made for the new path. The old file and its thumbnail stay in storage,
  so download links already sent keep working until they expire.
- **Backfill:** when the Resources page loads with files missing a thumbnail, it calls
  `POST /api/resources/thumbnail {org_id, missing: true}` once.
  - This renders every renderable file without one, archived files included, within a
    30 s budget, and answers `remaining`.
  - Fresh Air V1 is rendered this way the first time the page is opened after deploy.
- **Failure:** the route answers `state: 'tile'` with status 200 and logs one line with no
  content. The next backfill tries again.

## Where it shows
- **Resources page:** the thumbnail at the left of each row, in a fixed 3:4 frame with a
  subtle border, lazy-loaded.
  - The tile shows if the thumbnail is missing or fails to load.
  - Clicking it opens the file in a new tab through a 5-minute signed URL
    (`GET /api/resources/preview`).
- **Send resources** (contact card and in-call): a small version beside each checkbox.

## Vercel
- `next.config.js` keeps `pdfjs-dist` and `@napi-rs/canvas` external (not bundled).
- It traces pdfjs's `standard_fonts`, `cmaps` and `wasm` folders into
  `/api/resources/thumbnail`, the only function that renders. The list and send routes
  import `thumb-store.ts`, which never renders, so they stay small.
- The Linux canvas binary (`@napi-rs/canvas-linux-x64-gnu`, about 37 MB unpacked) is in the
  lockfile as a platform optional dependency.

## Files
| File | Purpose |
|---|---|
| `src/lib/resources/thumbs.ts` | Rules: path, kind, tile label, generate-or-tile, backfill pick |
| `src/lib/resources/thumb-render.ts` | pdfjs and canvas rendering |
| `src/lib/resources/thumb-generate.ts` | Download, render and store one thumbnail |
| `src/lib/resources/thumb-store.ts` | Which thumbnails exist, signed URLs |
| `src/app/api/resources/thumbnail/route.ts` | Make one, or backfill |
| `src/app/api/resources/preview/route.ts` | Signed URL to open a file |
| `src/app/api/resources/route.ts` | `thumb_url` on GET; Replace file on PATCH (`replace_path`) |
| `src/components/crm/resource-thumb.tsx` | Thumbnail or tile, generating state |
| `scripts/tests/resource-thumbnails.test.mjs` | 11 tests in `npm run test:voice` |
