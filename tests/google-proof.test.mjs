import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createMockGoogleArtifacts } from '../server/google-proof.mjs'

test('safe Google proof creates a real PDF and an escaped local document', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'fionnbar-google-proof-'))
  try {
    const artifacts = await createMockGoogleArtifacts({
      outputDirectory: directory,
      delivery: {
        weekId: '2026-09-28',
        documentId: 'mock-doc-test',
        documentName: 'Fionnbar Writing - Week of 2026-09-28',
        accountEmail: 'parent-test@example.com',
        recipient: 'school-test@example.com',
      },
      drafts: [{
        id: 'draft-1',
        title: 'The <Great> Adventure',
        body: 'Today I wrote a story.\nIt has two paragraphs.',
        findings: [{ category: 'Capitalization' }],
        updatedAt: '2026-10-03T16:00:00.000Z',
      }],
      generatedAt: new Date('2026-10-03T16:00:00.000Z'),
    })

    const pdf = readFileSync(artifacts.pdfPath)
    const document = readFileSync(artifacts.documentPath, 'utf8')
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-')
    assert.ok(statSync(artifacts.pdfPath).size > 1_000)
    assert.match(document, /LOCAL GOOGLE DELIVERY PROOF/)
    assert.match(document, /The &lt;Great&gt; Adventure/)
    assert.doesNotMatch(document, /<h2>The <Great>/)
    assert.match(document, /No Google account, Drive file, share, or email was created/)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
