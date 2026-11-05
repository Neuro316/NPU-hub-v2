// Unit tests for Resource Library thumbnails (src/lib/resources/thumbs.ts and
// src/lib/resources/thumb-render.ts). Run: npm run test:voice
// (Node 22.18+ / 23.6+ strips the TypeScript types natively.)
//
// The properties under test: a PDF and an image get a thumbnail at <path>.thumb.webp on
// upload; Replace file (a new path) makes a new one; DOCX and other types keep the tile
// without anything being downloaded; any failure (download, render, empty result, upload,
// timeout) leaves the tile and never throws; and the real renderer turns a PDF's first page
// and a PNG into a 480 px wide WebP.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createCanvas } from '@napi-rs/canvas'
import {
  makeThumbnail, needsThumbnail, thumbPath, thumbKind, tileLabel, THUMB_SUFFIX,
} from '../../src/lib/resources/thumbs.ts'
import { renderPdfThumb, renderImageThumb, THUMB_WIDTH } from '../../src/lib/resources/thumb-render.ts'

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'

/** A one-page PDF with a coloured block and Helvetica text (a standard font). */
function makePdf(text = 'Sleep guide') {
  const stream = `0.13 0.55 0.77 rg 40 600 300 120 re f\nBT /F1 36 Tf 0 0 0 rg 60 500 Td (${text}) Tj ET`
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let out = '%PDF-1.4\n'
  const offsets = []
  objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n` })
  const xref = out.length
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return new Uint8Array(Buffer.from(out, 'latin1'))
}

function makePng(w, h) {
  const c = createCanvas(w, h)
  const ctx = c.getContext('2d')
  ctx.fillStyle = '#228DC4'; ctx.fillRect(0, 0, w, h)
  return new Uint8Array(c.toBuffer('image/png'))
}

const isWebp = (b) => Buffer.from(b.subarray(0, 4)).toString() === 'RIFF' && Buffer.from(b.subarray(8, 12)).toString() === 'WEBP'
/** Width and height of a lossy (VP8) or lossless (VP8L) WebP, enough for these tests. */
function webpSize(b) {
  const buf = Buffer.from(b)
  const chunk = buf.subarray(12, 16).toString()
  if (chunk === 'VP8 ') return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff }
  if (chunk === 'VP8L') { const v = buf.readUInt32LE(21); return { w: (v & 0x3fff) + 1, h: ((v >> 14) & 0x3fff) + 1 } }
  if (chunk === 'VP8X') return { w: buf.readUIntLE(24, 3) + 1, h: buf.readUIntLE(27, 3) + 1 }
  return null
}

/** Storage and renderers as fakes, recording what happened. */
function fakes({ files = {}, failDownload = false, failRender = false, emptyRender = false, failUpload = false, slowMs = 0 } = {}) {
  const log = { downloads: [], pdf: 0, image: 0, uploads: {} }
  return {
    log,
    deps: {
      async download(path) {
        log.downloads.push(path)
        if (failDownload || !(path in files)) throw new Error('not found')
        return files[path]
      },
      async renderPdf() { log.pdf++; if (slowMs) await new Promise(r => setTimeout(r, slowMs)); if (failRender) throw new Error('bad pdf'); return emptyRender ? new Uint8Array() : new Uint8Array([1, 2, 3]) },
      async renderImage() { log.image++; if (failRender) throw new Error('bad image'); return emptyRender ? new Uint8Array() : new Uint8Array([4, 5, 6]) },
      async upload(path, webp) { if (failUpload) throw new Error('upload failed'); log.uploads[path] = webp },
      timeoutMs: 50,
    },
  }
}

const ORG = '00000000-0000-0000-0000-000000000001'
const PDF_PATH = `${ORG}/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa-guide.pdf`
const PNG_PATH = `${ORG}/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb-photo.png`

test('a PDF gets a thumbnail beside it on upload', async () => {
  const { deps, log } = fakes({ files: { [PDF_PATH]: makePdf() } })
  assert.equal(await makeThumbnail({ storage_path: PDF_PATH, mime_type: 'application/pdf' }, deps), 'ready')
  assert.equal(log.pdf, 1)
  assert.deepEqual(Object.keys(log.uploads), [`${PDF_PATH}.thumb.webp`])
})

test('an image gets a thumbnail beside it on upload', async () => {
  for (const mime of ['image/png', 'image/jpeg', 'image/webp', 'image/gif']) {
    const { deps, log } = fakes({ files: { [PNG_PATH]: makePng(10, 10) } })
    assert.equal(await makeThumbnail({ storage_path: PNG_PATH, mime_type: mime }, deps), 'ready', mime)
    assert.equal(log.image, 1)
    assert.ok(log.uploads[thumbPath(PNG_PATH)])
  }
})

test('Replace file makes a new thumbnail at the new path; the old one is left alone', async () => {
  const NEW_PATH = `${ORG}/cccccccc-cccc-cccc-cccc-cccccccccccc-guide-v2.pdf`
  const { deps, log } = fakes({ files: { [PDF_PATH]: makePdf('v1'), [NEW_PATH]: makePdf('v2') } })
  await makeThumbnail({ storage_path: PDF_PATH, mime_type: 'application/pdf' }, deps)
  assert.equal(await makeThumbnail({ storage_path: NEW_PATH, mime_type: 'application/pdf' }, deps), 'ready')
  assert.deepEqual(log.downloads, [PDF_PATH, NEW_PATH])
  assert.deepEqual(Object.keys(log.uploads).sort(), [`${NEW_PATH}.thumb.webp`, `${PDF_PATH}.thumb.webp`].sort())
})

test('remaking a thumbnail for the same file overwrites it', async () => {
  const { deps, log } = fakes({ files: { [PDF_PATH]: makePdf() } })
  await makeThumbnail({ storage_path: PDF_PATH, mime_type: 'application/pdf' }, deps)
  await makeThumbnail({ storage_path: PDF_PATH, mime_type: 'application/pdf' }, deps)
  assert.equal(log.pdf, 2)
  assert.equal(Object.keys(log.uploads).length, 1)
})

test('DOCX, PPTX and other types keep the tile and nothing is downloaded', async () => {
  for (const mime of [DOCX, PPTX, 'application/zip', '']) {
    const { deps, log } = fakes()
    assert.equal(await makeThumbnail({ storage_path: `${ORG}/x-file`, mime_type: mime }, deps), 'tile')
    assert.equal(log.downloads.length, 0)
    assert.equal(Object.keys(log.uploads).length, 0)
  }
})

test('any failure falls back to the tile and never throws', async () => {
  const pdf = { storage_path: PDF_PATH, mime_type: 'application/pdf' }
  const files = { [PDF_PATH]: makePdf() }
  for (const opts of [{ failDownload: true }, { failRender: true }, { emptyRender: true }, { failUpload: true }, { slowMs: 200 }]) {
    const { deps, log } = fakes({ files, ...opts })
    assert.equal(await makeThumbnail(pdf, deps), 'tile', JSON.stringify(opts))
    if (!opts.slowMs) assert.equal(Object.keys(log.uploads).length, 0)
  }
})

test('the real renderer: a corrupt PDF is a failure, so the file keeps its tile', async () => {
  const deps = {
    download: async () => new Uint8Array(Buffer.from('%PDF-1.4 this is not a pdf')),
    renderPdf: renderPdfThumb, renderImage: renderImageThumb,
    upload: async () => { throw new Error('must not upload') },
  }
  assert.equal(await makeThumbnail({ storage_path: PDF_PATH, mime_type: 'application/pdf' }, deps), 'tile')
})

test('the real renderer: a PDF first page becomes a 480 px wide WebP', async () => {
  const webp = await renderPdfThumb(makePdf())
  assert.ok(isWebp(webp))
  const size = webpSize(webp)
  assert.equal(size.w, THUMB_WIDTH)
  assert.equal(size.h, Math.round(792 * THUMB_WIDTH / 612))
})

test('the real renderer: a large image is scaled to 480 px wide, a small one is not enlarged', async () => {
  const big = webpSize(await renderImageThumb(makePng(1600, 1200)))
  assert.deepEqual(big, { w: 480, h: 360 })
  const small = await renderImageThumb(makePng(200, 100))
  assert.ok(isWebp(small))
  assert.deepEqual(webpSize(small), { w: 200, h: 100 })
})

test('backfill picks files that get a thumbnail and do not have one', () => {
  const files = [
    { storage_path: PDF_PATH, mime_type: 'application/pdf' },
    { storage_path: PNG_PATH, mime_type: 'image/png' },
    { storage_path: `${ORG}/d-notes.docx`, mime_type: DOCX },
  ]
  const todo = needsThumbnail(files, new Set([thumbPath(PNG_PATH)]))
  assert.deepEqual(todo.map(f => f.storage_path), [PDF_PATH])
})

test('paths, kinds and tile labels', () => {
  assert.equal(thumbPath('o/f.pdf'), `o/f.pdf${THUMB_SUFFIX}`)
  assert.equal(thumbKind('APPLICATION/PDF'), 'pdf')
  assert.equal(thumbKind('image/svg+xml'), 'tile')
  assert.equal(tileLabel(DOCX), 'DOCX')
  assert.equal(tileLabel(PPTX), 'PPTX')
  assert.equal(tileLabel('application/octet-stream', 'deck.key'), 'KEY')
  assert.equal(tileLabel('application/octet-stream', 'noext'), 'FILE')
})
