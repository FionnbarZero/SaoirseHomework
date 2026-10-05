export type TextEdit = { start: number; end: number; replacement: string }

// Half-open ranges: punctuation at the edge of a corrected word is compatible.
export function editsConflict(left: Pick<TextEdit, 'start' | 'end'>, right: Pick<TextEdit, 'start' | 'end'>) {
  if (left.start === left.end && right.start === right.end) return left.start === right.start
  if (left.start === left.end) return left.start > right.start && left.start < right.end
  if (right.start === right.end) return right.start > left.start && right.start < left.end
  return left.start < right.end && left.end > right.start
}

export function sameEdit(left: TextEdit, right: TextEdit) {
  return left.start === right.start && left.end === right.end && left.replacement === right.replacement
}

// Split broad replacements at unchanged tokens so shared context does not
// suppress independent corrections. Every edit still addresses the original.
export function atomicEdits(original: string, replacement: string, start: number): TextEdit[] {
  const tokenize = (text: string) => text.match(/[\p{L}\p{N}'’_-]+|\s+|[^\p{L}\p{N}\s]/gu) ?? []
  const before = tokenize(original)
  const after = tokenize(replacement)
  const lengths = Array.from({ length: before.length + 1 }, () => new Uint16Array(after.length + 1))
  for (let i = before.length - 1; i >= 0; i -= 1) {
    for (let j = after.length - 1; j >= 0; j -= 1) {
      lengths[i][j] = before[i] === after[j]
        ? 1 + lengths[i + 1][j + 1]
        : Math.max(lengths[i + 1][j], lengths[i][j + 1])
    }
  }
  const edits: TextEdit[] = []
  let pending: TextEdit | undefined
  let offset = start
  let i = 0
  let j = 0
  const flush = () => {
    if (pending) edits.push(pending)
    pending = undefined
  }
  while (i < before.length || j < after.length) {
    if (i < before.length && j < after.length && before[i] === after[j]) {
      flush()
      offset += before[i++].length
      j += 1
    } else {
      pending ??= { start: offset, end: offset, replacement: '' }
      if (i < before.length && (j === after.length || lengths[i + 1][j] >= lengths[i][j + 1])) {
        offset += before[i++].length
        pending.end = offset
      } else {
        pending.replacement += after[j++]
      }
    }
  }
  flush()
  return edits.flatMap((edit) => {
    const source = original.slice(edit.start - start, edit.end - start)
    const withPunctuation = edit.replacement.match(/^([\p{L}\p{N}'’_-]+)([^\p{L}\p{N}\s]+)$/u)
    if (!/^[\p{L}\p{N}'’_-]+$/u.test(source) || !withPunctuation) return [edit]
    return [
      { ...edit, replacement: withPunctuation[1] },
      { start: edit.end, end: edit.end, replacement: withPunctuation[2] },
    ]
  })
}
