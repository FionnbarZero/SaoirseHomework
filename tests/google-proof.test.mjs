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
        correctedBody: 'Today I wrote a great story.\nIt has two paragraphs.',
        findings: [{ id: 'grammar-1', category: 'Grammar' }],
        exerciseProgress: {
          'grammar-1': {
            correctionComplete: true,
            practiceCompleted: 5,
            attemptResults: [false, true, true, false, true, true],
          },
        },
        spellingWords: [{ id: 'spelling-story', word: 'storry', correctWord: 'story', occurrences: 1 }],
        spellingProgress: {
          'spelling-story': { copyCompleted: 3, hiddenCompleted: 3, mixedCompleted: 3, incorrectAttempts: 1 },
        },
        reviewStatus: 'complete',
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
    assert.match(document, /Corrected copy/)
    assert.match(document, /Today I wrote a great story/)
    assert.match(document, /6 of 6 correction and practice steps completed/)
    assert.match(document, /Writing game score: 4 of 6 correct \(67%\)/)
    assert.match(document, /Accuracy by response: 0%, 50%, 67%, 50%, 60%, 67%/)
    assert.match(document, /9 of 9 spelling-practice responses completed/)
    assert.doesNotMatch(document, /<h2>The <Great>/)
    assert.match(document, /No Google account, Drive file, share, or email was created/)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
