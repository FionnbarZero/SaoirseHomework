import { createWriteStream } from 'node:fs'
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import PDFDocument from 'pdfkit'

const COLORS = {
  ink: '#283733',
  muted: '#71807a',
  teal: '#355f57',
  orange: '#a45e3f',
  cream: '#f5f0e5',
  line: '#d9dfdb',
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function safeFilename(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function formatDate(value) {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date(value))
}

function formatReadingDate(value) {
  const candidate = String(value ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return ''
  const date = new Date(`${candidate}T12:00:00.000Z`)
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== candidate) return ''
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(date)
}

function readingDetails(draft) {
  const date = formatReadingDate(draft.readingDate)
  return [
    ['Book title', draft.title || 'Untitled writing'],
    ['Author', draft.author],
    ['Reading date', date],
    ['Pages read', draft.pagesRead],
  ].filter(([, value]) => String(value ?? '').trim())
}

function practiceSummary(draft) {
  const progress = draft.exerciseProgress && typeof draft.exerciseProgress === 'object'
    ? draft.exerciseProgress
    : {}
  const completed = draft.findings.reduce((total, finding) => {
    const item = progress[finding.id]
    const practiceTarget = Array.isArray(finding.practice) ? finding.practice.length : 3
    return total + (item?.correctionComplete ? 1 : 0) +
      Math.min(practiceTarget, Number(item?.practiceCompleted) || 0)
  }, 0)
  const total = draft.findings.reduce(
    (sum, finding) => sum + (Array.isArray(finding.practice) ? finding.practice.length : 3) + 1,
    0,
  )
  const categories = [...new Set(draft.findings.map((finding) => finding.category))]
  const attemptResults = draft.findings.flatMap((finding) => {
    const results = progress[finding.id]?.attemptResults
    return Array.isArray(results) ? results.filter((result) => typeof result === 'boolean') : []
  })
  const correctResponses = attemptResults.filter(Boolean).length
  const scorePercent = attemptResults.length
    ? Math.round((correctResponses / attemptResults.length) * 100)
    : null
  const cumulativePercent = attemptResults.map((_, index) => {
    const correctSoFar = attemptResults.slice(0, index + 1).filter(Boolean).length
    return Math.round((correctSoFar / (index + 1)) * 100)
  })
  const spellingWords = Array.isArray(draft.spellingWords) ? draft.spellingWords : []
  const spellingProgress = draft.spellingProgress && typeof draft.spellingProgress === 'object'
    ? draft.spellingProgress
    : {}
  const spellingCompleted = spellingWords.reduce((total, word) => {
    const item = spellingProgress[word.id]
    return total + Math.min(3, Number(item?.copyCompleted) || 0) +
      Math.min(3, Number(item?.hiddenCompleted) || 0) +
      Math.min(3, Number(item?.mixedCompleted) || 0)
  }, 0)
  const spellingTotal = spellingWords.length * 9
  const spellingFindingCount = draft.findings.filter((finding) => finding.category === 'Spelling').length
  const spellingText = draft.reviewStatus === 'complete'
    ? spellingWords.length
      ? `${spellingCompleted} of ${spellingTotal} spelling-practice responses completed for ${spellingWords.length} ${spellingWords.length === 1 ? 'word' : 'words'}.`
      : spellingFindingCount
        ? `${spellingFindingCount} reviewed ${spellingFindingCount === 1 ? 'misspelling was' : 'misspellings were'} completed in the multiple-choice game.`
      : 'No supported common misspellings were detected.'
    : 'Spelling practice is not complete.'
  return {
    completed,
    total,
    text: draft.findings.length
      ? `${completed} of ${total} correction and practice steps completed across ${categories.join(', ').toLowerCase()}.`
      : 'No supported grammar, punctuation, or capitalization findings were detected.',
    scoreText: scorePercent === null
      ? 'No scored writing responses were recorded.'
      : `First-try writing game score: ${correctResponses} of ${attemptResults.length} correct (${scorePercent}%). First-try accuracy by question: ${cumulativePercent.map((value) => `${value}%`).join(', ')}.`,
    spellingText,
  }
}

function htmlDocument({ documentName, weekId, accountEmail, recipient, drafts, generatedAt }) {
  const draftSections = drafts.map((draft, index) => {
    const summary = practiceSummary(draft)
    const versionLabel = `Version ${Math.max(1, Number(draft.versionNumber) || 1)}`
    const metadata = readingDetails(draft)
      .map(([label, value]) => `<span><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</span>`)
      .join('')
    return `
    <section class="draft">
      <p class="draft-number">WRITING ${index + 1}</p>
      <h2>${escapeHtml(draft.title || 'Untitled writing')} — ${escapeHtml(versionLabel)}</h2>
      <p class="date">Saved ${escapeHtml(formatDate(draft.updatedAt))}</p>
      <p class="reading-details">${metadata}</p>
      <h3>Original draft</h3>
      <div class="body">${escapeHtml(draft.body).replaceAll('\n', '<br />')}</div>
      <h3>Corrected copy</h3>
      <div class="body corrected">${escapeHtml(draft.correctedBody ?? draft.body).replaceAll('\n', '<br />')}</div>
      <p class="practice">${escapeHtml(summary.text)} ${escapeHtml(summary.scoreText)} ${escapeHtml(summary.spellingText)}</p>
    </section>
  `
  }).join('')

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(documentName)}</title>
  <style>
    :root { color: #283733; background: #e8ede9; font-family: Arial, sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; padding: 40px 18px; }
    main { width: min(780px, 100%); margin: auto; padding: 54px; border: 1px solid #d9dfdb; border-radius: 22px; background: #fff; box-shadow: 0 18px 55px rgba(45,65,59,.12); }
    .proof { margin: 0 0 8px; color: #a45e3f; font-size: 11px; font-weight: 800; letter-spacing: .15em; }
    h1, h2 { font-family: Georgia, serif; font-weight: 500; }
    h1 { margin: 0; font-size: 38px; }
    .meta { margin: 10px 0 34px; color: #71807a; font-size: 12px; line-height: 1.6; }
    .notice { padding: 14px 16px; border-radius: 12px; color: #355f57; background: #edf3f0; font-size: 12px; line-height: 1.5; }
    .draft { margin-top: 34px; padding-top: 30px; border-top: 1px solid #d9dfdb; }
    .draft-number { margin: 0; color: #a45e3f; font-size: 10px; font-weight: 800; letter-spacing: .13em; }
    h2 { margin: 6px 0; font-size: 28px; }
    .date { margin: 0 0 24px; color: #71807a; font-size: 11px; }
    .reading-details { margin: -14px 0 24px; display: flex; flex-wrap: wrap; gap: 6px 18px; color: #586761; font-size: 11px; }
    .reading-details span { white-space: nowrap; }
    h3 { margin: 18px 0 9px; font-size: 12px; text-transform: uppercase; letter-spacing: .08em; }
    .body { padding: 18px; border-left: 4px solid #d6a566; border-radius: 0 12px 12px 0; background: #f5f0e5; font-family: Georgia, serif; font-size: 16px; line-height: 1.65; }
    .body.corrected { border-left-color: #4f887d; background: #edf3f0; }
    .practice { color: #71807a; font-size: 11px; line-height: 1.55; }
    footer { margin-top: 38px; color: #84908b; font-size: 10px; }
  </style>
</head>
<body>
  <main>
    <p class="proof">LOCAL GOOGLE DELIVERY PROOF</p>
    <h1>${escapeHtml(documentName)}</h1>
    <p class="meta">Week ID: ${escapeHtml(weekId)}<br />Test account: ${escapeHtml(accountEmail)}<br />Test recipient: ${escapeHtml(recipient)}</p>
    <p class="notice">This local artifact proves weekly document assembly and export. No Google account, Drive file, share, or email was created.</p>
    ${draftSections}
    <footer>Generated ${escapeHtml(formatDate(generatedAt))} by Saoirse Homework App safe test mode.</footer>
  </main>
</body>
</html>`
}

async function writePdf(path, details) {
  await new Promise((resolve, reject) => {
    const output = createWriteStream(path)
    const pdf = new PDFDocument({
      size: 'LETTER',
      margins: { top: 64, right: 58, bottom: 66, left: 58 },
      bufferPages: true,
      info: {
        Title: details.documentName,
        Author: 'Saoirse Homework App - safe test mode',
        Subject: 'Local Google delivery feasibility proof',
      },
    })
    pdf.pipe(output)
    output.on('finish', resolve)
    output.on('error', reject)
    pdf.on('error', reject)

    const drawHeader = () => {
      pdf.save()
      pdf.rect(0, 0, pdf.page.width, pdf.page.height).fill('#ffffff')
      pdf.rect(0, 0, pdf.page.width, 16).fill(COLORS.teal)
      pdf.restore()
      pdf.x = 58
      pdf.y = 64
    }
    pdf.on('pageAdded', drawHeader)
    drawHeader()

    pdf.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.orange)
      .text('LOCAL GOOGLE DELIVERY PROOF', { characterSpacing: 1.25 })
    pdf.moveDown(0.7)
    pdf.font('Times-Roman').fontSize(28).fillColor(COLORS.ink).text(details.documentName)
    pdf.moveDown(0.45)
    pdf.font('Helvetica').fontSize(9).fillColor(COLORS.muted)
      .text(`Week ID: ${details.weekId}`)
      .text(`Test account: ${details.accountEmail}`)
      .text(`Test recipient: ${details.recipient}`)
    pdf.moveDown(1.2)

    const noticeTop = pdf.y
    pdf.roundedRect(58, noticeTop, 496, 48, 8).fill(COLORS.cream)
    pdf.font('Helvetica').fontSize(9).fillColor(COLORS.teal)
      .text(
        'This local artifact proves weekly document assembly and PDF export. No Google account, Drive file, share, or email was created.',
        72,
        noticeTop + 12,
        { width: 468, lineGap: 2 },
      )
    pdf.y = noticeTop + 66

    for (const [index, draft] of details.drafts.entries()) {
      const summary = practiceSummary(draft)
      if (pdf.y > 610) pdf.addPage()
      pdf.moveTo(58, pdf.y).lineTo(554, pdf.y).lineWidth(0.8).strokeColor(COLORS.line).stroke()
      pdf.moveDown(1.4)
      pdf.font('Helvetica-Bold').fontSize(8).fillColor(COLORS.orange)
        .text(`WRITING ${index + 1}`, { characterSpacing: 1.1 })
      pdf.moveDown(0.45)
      pdf.font('Times-Roman').fontSize(21).fillColor(COLORS.ink).text(draft.title || 'Untitled writing')
      pdf.moveDown(0.25)
      pdf.font('Helvetica').fontSize(8).fillColor(COLORS.muted)
        .text(`Saved ${formatDate(draft.updatedAt)}`)
      for (const [label, value] of readingDetails(draft)) {
        pdf.text(`${label}: ${value}`)
      }
      pdf.moveDown(1.2)
      pdf.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.ink).text('ORIGINAL DRAFT')
      pdf.moveDown(0.5)
      pdf.font('Times-Roman').fontSize(11).fillColor(COLORS.ink)
        .text(draft.body, { lineGap: 4, paragraphGap: 6 })
      pdf.moveDown(0.9)
      pdf.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.ink).text('CORRECTED COPY')
      pdf.moveDown(0.5)
      pdf.font('Times-Roman').fontSize(11).fillColor(COLORS.ink)
        .text(draft.correctedBody ?? draft.body, { lineGap: 4, paragraphGap: 6 })
      pdf.moveDown(0.9)
      pdf.font('Helvetica-Oblique').fontSize(8).fillColor(COLORS.muted)
        .text(
          `${summary.text} ${summary.scoreText} ${summary.spellingText}`,
          { lineGap: 2 },
        )
      pdf.moveDown(1.4)
    }

    const pageRange = pdf.bufferedPageRange()
    for (let pageIndex = pageRange.start; pageIndex < pageRange.start + pageRange.count; pageIndex += 1) {
      pdf.switchToPage(pageIndex)
      const bottomMargin = pdf.page.margins.bottom
      pdf.page.margins.bottom = 30
      pdf.font('Helvetica').fontSize(7).fillColor(COLORS.muted)
        .text(
          `Safe test mode - ${formatDate(details.generatedAt)} - Page ${pageIndex - pageRange.start + 1} of ${pageRange.count}`,
          58,
          748,
          { width: 496, align: 'center', lineBreak: false },
        )
      pdf.page.margins.bottom = bottomMargin
    }
    pdf.end()
  })
}

export async function createMockGoogleArtifacts({ outputDirectory, delivery, drafts, generatedAt = new Date() }) {
  await mkdir(outputDirectory, { recursive: true })
  const basename = safeFilename(`fionnbar-writing-week-of-${delivery.weekId}-${delivery.documentId}`)
  const documentPath = join(outputDirectory, `${basename}.html`)
  const pdfPath = join(outputDirectory, `${basename}.pdf`)
  const temporaryDocumentPath = `${documentPath}.tmp`
  const temporaryPdfPath = `${pdfPath}.tmp`
  const details = {
    documentName: delivery.documentName,
    weekId: delivery.weekId,
    accountEmail: delivery.accountEmail,
    recipient: delivery.recipient,
    drafts,
    generatedAt,
  }

  try {
    await writeFile(temporaryDocumentPath, htmlDocument(details), 'utf8')
    await writePdf(temporaryPdfPath, details)
    await rename(temporaryDocumentPath, documentPath)
    await rename(temporaryPdfPath, pdfPath)
    return { documentPath, pdfPath }
  } catch (error) {
    await Promise.all([
      unlink(temporaryDocumentPath).catch(() => {}),
      unlink(temporaryPdfPath).catch(() => {}),
      unlink(documentPath).catch(() => {}),
      unlink(pdfPath).catch(() => {}),
    ])
    throw error
  }
}
