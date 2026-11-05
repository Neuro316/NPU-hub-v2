// src/lib/resources/thumb-render.ts
// Server-side thumbnail rendering for the Resource Library: a PDF's first page or a scaled
// image, as a THUMB_WIDTH px wide WebP. Only package imports, so
// scripts/tests/resource-thumbnails.test.mjs renders real files with it.
//
// pdfjs-dist runs without a worker in Node: importing its worker module first sets
// globalThis.pdfjsWorker, which pdfjs uses in place of a worker thread. Fonts and image
// decoders are read from node_modules/pdfjs-dist (next.config.js traces them into the
// functions that render). Canvas is @napi-rs/canvas, the canvas pdfjs itself uses in Node.
import path from 'node:path'
import { createCanvas, loadImage } from '@napi-rs/canvas'

export const THUMB_WIDTH = 480
/** A page or image taller than this ratio is cropped to it (a long scroll of a PDF page). */
const MAX_HEIGHT_RATIO = 2
const WEBP_QUALITY = 82

/** A pdfjs data folder: pdfjs wants forward slashes and a trailing slash, on Windows too. */
const pdfjsData = (sub: string) => path.join(process.cwd(), 'node_modules', 'pdfjs-dist', sub).split(path.sep).join('/') + '/'

async function loadPdfjs() {
  // @ts-expect-error the worker module has no type declarations
  await import('pdfjs-dist/legacy/build/pdf.worker.mjs')
  return import('pdfjs-dist/legacy/build/pdf.mjs')
}

/** The first page of a PDF, THUMB_WIDTH wide, as WebP. Throws when it cannot be read. */
export async function renderPdfThumb(bytes: Uint8Array, width = THUMB_WIDTH): Promise<Buffer> {
  const pdfjs = await loadPdfjs()
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    standardFontDataUrl: pdfjsData('standard_fonts'),
    cMapUrl: pdfjsData('cmaps'),
    cMapPacked: true,
    wasmUrl: pdfjsData('wasm'),
    disableFontFace: true,
    verbosity: 0,
  })
  try {
    const doc = await task.promise
    const page = await doc.getPage(1)
    const base = page.getViewport({ scale: 1 })
    const viewport = page.getViewport({ scale: width / base.width })
    const w = Math.max(1, Math.round(viewport.width))
    const h = Math.max(1, Math.min(Math.round(viewport.height), w * MAX_HEIGHT_RATIO))
    const canvas = createCanvas(w, h)
    const context = canvas.getContext('2d')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, w, h)
    await page.render({ canvas: canvas as any, canvasContext: context as any, viewport }).promise
    return await canvas.encode('webp', WEBP_QUALITY)
  } finally {
    await task.destroy()
  }
}

/** An image scaled down to THUMB_WIDTH wide (never up), as WebP. GIFs use the first frame. */
export async function renderImageThumb(bytes: Uint8Array, width = THUMB_WIDTH): Promise<Buffer> {
  const img = await loadImage(Buffer.from(bytes))
  if (!img.width || !img.height) throw new Error('empty image')
  const scale = Math.min(1, width / img.width)
  const w = Math.max(1, Math.round(img.width * scale))
  const h = Math.max(1, Math.min(Math.round(img.height * scale), w * MAX_HEIGHT_RATIO))
  const canvas = createCanvas(w, h)
  canvas.getContext('2d').drawImage(img, 0, 0, w, Math.round(img.height * scale))
  return canvas.encode('webp', WEBP_QUALITY)
}
