// src/app/api/meetings/agenda-template/route.ts
// Generates a branded agenda .docx template for download
// Also accepts ?meeting_id to generate a filled agenda for a specific meeting

import { NextResponse } from 'next/server'
import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  HeadingLevel, AlignmentType, BorderStyle, WidthType, ShadingType,
  LevelFormat, Header, Footer, PageNumber, NumberFormat,
} from 'docx'
import { createAdminSupabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const BRAND_BLUE    = '386797'
const BRAND_TEAL    = '2A9D8F'
const LIGHT_BLUE    = 'E8F0F7'
const BORDER_GRAY   = 'CCCCCC'
const TEXT_DARK     = '1A1A2E'
const TEXT_GRAY     = '6B7280'

function cellBorder(color = BORDER_GRAY) {
  const b = { style: BorderStyle.SINGLE, size: 1, color }
  return { top: b, bottom: b, left: b, right: b }
}

function sectionRow(name: string, duration: string, prompts: string[], notes: string) {
  return [
    new TableRow({
      children: [
        new TableCell({
          width: { size: 5000, type: WidthType.DXA },
          borders: cellBorder(BRAND_BLUE),
          shading: { fill: LIGHT_BLUE, type: ShadingType.CLEAR },
          margins: { top: 100, bottom: 100, left: 160, right: 160 },
          children: [
            new Paragraph({
              children: [new TextRun({ text: name, bold: true, size: 22, color: TEXT_DARK, font: 'Arial' })],
            }),
            ...prompts.map(p =>
              new Paragraph({
                numbering: { reference: 'bullets', level: 0 },
                children: [new TextRun({ text: p, size: 18, color: TEXT_GRAY, font: 'Arial' })],
              })
            ),
          ],
        }),
        new TableCell({
          width: { size: 1200, type: WidthType.DXA },
          borders: cellBorder(),
          margins: { top: 100, bottom: 100, left: 120, right: 120 },
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: duration, size: 20, bold: true, color: BRAND_BLUE, font: 'Arial' })],
          })],
        }),
        new TableCell({
          width: { size: 3160, type: WidthType.DXA },
          borders: cellBorder(),
          margins: { top: 100, bottom: 100, left: 120, right: 120 },
          children: [new Paragraph({
            children: [new TextRun({ text: notes || ' ', size: 18, color: TEXT_GRAY, font: 'Arial' })],
          })],
        }),
      ],
    }),
  ]
}

function headerRow() {
  return new TableRow({
    tableHeader: true,
    children: ['Agenda Item / Discussion Prompts', 'Time', 'Notes'].map((h, i) => {
      const widths = [5000, 1200, 3160]
      return new TableCell({
        width: { size: widths[i], type: WidthType.DXA },
        borders: cellBorder(BRAND_BLUE),
        shading: { fill: BRAND_BLUE, type: ShadingType.CLEAR },
        margins: { top: 80, bottom: 80, left: 160, right: 160 },
        children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: h, bold: true, size: 20, color: 'FFFFFF', font: 'Arial' })],
        })],
      })
    }),
  })
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const meetingId = searchParams.get('meeting_id')

  let title = 'Meeting Agenda Template'
  let dateStr = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
  let durationStr = '60 minutes'
  let sections: { section: string; duration_min: number; notes: string; prompts?: string[] }[] = [
    { section: 'Opening / Check-in', duration_min: 5, notes: '', prompts: ['How is everyone doing?', 'Any blockers since last time?'] },
    { section: 'Review Previous Actions', duration_min: 10, notes: '', prompts: ['What was completed?', 'What carried over and why?'] },
    { section: 'Main Topic 1', duration_min: 15, notes: '', prompts: ['What is the issue?', 'What are the options?', 'Who owns the decision?'] },
    { section: 'Main Topic 2', duration_min: 15, notes: '', prompts: [] },
    { section: 'IDS / Problem Solving', duration_min: 20, notes: '', prompts: ['Identify the issue', 'Discuss options', 'Solve and assign'] },
    { section: 'Action Items & Close', duration_min: 5, notes: '', prompts: ['What are the key takeaways?', 'Who owns what?'] },
  ]

  if (meetingId) {
    const sb = createAdminSupabase()
    const { data: m } = await sb.from('meetings').select('*').eq('id', meetingId).single()
    if (m) {
      title = m.title || title
      dateStr = m.scheduled_at
        ? new Date(m.scheduled_at).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
        : dateStr
      durationStr = `${m.duration_minutes || 60} minutes`
      if (m.agenda?.length > 0) sections = m.agenda
    }
  }

  const totalMins = sections.reduce((s, x) => s + (x.duration_min || 0), 0)

  const doc = new Document({
    numbering: {
      config: [{
        reference: 'bullets',
        levels: [{ level: 0, format: LevelFormat.BULLET, text: '\u2022', alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 360, hanging: 180 } } } }],
      }],
    },
    styles: {
      default: { document: { run: { font: 'Arial', size: 22, color: TEXT_DARK } } },
    },
    sections: [{
      properties: {
        page: {
          size: { width: 12240, height: 15840 },
          margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 },
        },
      },
      headers: {
        default: new Header({
          children: [
            new Paragraph({
              border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: BRAND_BLUE } },
              children: [
                new TextRun({ text: 'Neuro Progeny  |  ', bold: true, size: 20, color: BRAND_BLUE, font: 'Arial' }),
                new TextRun({ text: title, size: 20, color: TEXT_GRAY, font: 'Arial' }),
              ],
            }),
          ],
        }),
      },
      footers: {
        default: new Footer({
          children: [
            new Paragraph({
              border: { top: { style: BorderStyle.SINGLE, size: 2, color: BORDER_GRAY } },
              alignment: AlignmentType.CENTER,
              children: [
                new TextRun({ text: 'Page ', size: 16, color: TEXT_GRAY, font: 'Arial' }),
                new TextRun({ children: [PageNumber.CURRENT], size: 16, color: TEXT_GRAY, font: 'Arial' }),
                new TextRun({ text: ' of ', size: 16, color: TEXT_GRAY, font: 'Arial' }),
                new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16, color: TEXT_GRAY, font: 'Arial' }),
              ],
            }),
          ],
        }),
      },
      children: [
        // Title block
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 80 },
          children: [new TextRun({ text: title, bold: true, size: 40, color: BRAND_BLUE, font: 'Arial' })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 60 },
          children: [new TextRun({ text: dateStr, size: 22, color: TEXT_GRAY, font: 'Arial' })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 320 },
          children: [
            new TextRun({ text: `Total time: ${durationStr}  ·  ${sections.length} sections  ·  ${totalMins} min planned`, size: 18, color: TEXT_GRAY, font: 'Arial' }),
          ],
        }),

        // Agenda table
        new Table({
          width: { size: 9360, type: WidthType.DXA },
          columnWidths: [5000, 1200, 3160],
          rows: [
            headerRow(),
            ...sections.flatMap(s => sectionRow(
              s.section,
              `${s.duration_min} min`,
              s.prompts || [],
              s.notes || ''
            )),
            // Totals row
            new TableRow({
              children: [
                new TableCell({
                  width: { size: 5000, type: WidthType.DXA },
                  borders: cellBorder(BRAND_BLUE),
                  shading: { fill: BRAND_BLUE, type: ShadingType.CLEAR },
                  margins: { top: 80, bottom: 80, left: 160, right: 160 },
                  children: [new Paragraph({
                    alignment: AlignmentType.RIGHT,
                    children: [new TextRun({ text: 'TOTAL', bold: true, size: 20, color: 'FFFFFF', font: 'Arial' })],
                  })],
                }),
                new TableCell({
                  width: { size: 1200, type: WidthType.DXA },
                  borders: cellBorder(BRAND_BLUE),
                  shading: { fill: BRAND_BLUE, type: ShadingType.CLEAR },
                  margins: { top: 80, bottom: 80, left: 120, right: 120 },
                  children: [new Paragraph({
                    alignment: AlignmentType.CENTER,
                    children: [new TextRun({ text: `${totalMins} min`, bold: true, size: 20, color: 'FFFFFF', font: 'Arial' })],
                  })],
                }),
                new TableCell({
                  width: { size: 3160, type: WidthType.DXA },
                  borders: cellBorder(BRAND_BLUE),
                  shading: { fill: BRAND_BLUE, type: ShadingType.CLEAR },
                  margins: { top: 80, bottom: 80, left: 120, right: 120 },
                  children: [new Paragraph({ children: [new TextRun({ text: ' ' })] })],
                }),
              ],
            }),
          ],
        }),

        // Notes section
        new Paragraph({ spacing: { before: 400 } }),
        new Paragraph({
          border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: BRAND_TEAL } },
          children: [new TextRun({ text: 'Meeting Notes', bold: true, size: 26, color: BRAND_TEAL, font: 'Arial' })],
        }),
        ...[...Array(8)].map(() => new Paragraph({
          border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: 'E5E7EB' } },
          spacing: { after: 240 },
          children: [new TextRun({ text: ' ' })],
        })),

        // Action items section
        new Paragraph({
          border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: BRAND_BLUE } },
          children: [new TextRun({ text: 'Action Items', bold: true, size: 26, color: BRAND_BLUE, font: 'Arial' })],
        }),
        new Table({
          width: { size: 9360, type: WidthType.DXA },
          columnWidths: [4680, 2340, 2340],
          rows: [
            new TableRow({
              children: ['Task / Description', 'Owner', 'Due Date'].map((h, i) => {
                const widths = [4680, 2340, 2340]
                return new TableCell({
                  width: { size: widths[i], type: WidthType.DXA },
                  borders: cellBorder(BRAND_BLUE),
                  shading: { fill: BRAND_BLUE, type: ShadingType.CLEAR },
                  margins: { top: 80, bottom: 80, left: 120, right: 120 },
                  children: [new Paragraph({
                    children: [new TextRun({ text: h, bold: true, size: 20, color: 'FFFFFF', font: 'Arial' })],
                  })],
                })
              }),
            }),
            ...[...Array(6)].map(() => new TableRow({
              children: [4680, 2340, 2340].map(w => new TableCell({
                width: { size: w, type: WidthType.DXA },
                borders: cellBorder(),
                margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [new Paragraph({ children: [new TextRun({ text: ' ' })] })],
              })),
            })),
          ],
        }),
      ],
    }],
  })

  const buffer = await Packer.toBuffer(doc)
  const filename = meetingId ? 'meeting-agenda.docx' : 'agenda-template.docx'

  return new Response(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
