import { describe, expect, test } from 'bun:test'
import { mermaidDiagramSource } from './mermaid'

// The hast shape react-markdown hands the `pre` component for a fenced block.
function fencedBlock(language: string | null, ...textChunks: string[]) {
  return {
    type: 'element',
    tagName: 'pre',
    children: [
      {
        type: 'element',
        tagName: 'code',
        properties: language === null ? {} : { className: [`language-${language}`] },
        children: textChunks.map((value) => ({ type: 'text', value })),
      },
    ],
  }
}

describe('mermaidDiagramSource', () => {
  test('returns the source text of a mermaid fenced block', () => {
    const source = mermaidDiagramSource(fencedBlock('mermaid', 'graph TD\n  A --> B\n'))
    expect(source).toBe('graph TD\n  A --> B')
  })

  test('joins the text nodes a fence may be split into', () => {
    const source = mermaidDiagramSource(fencedBlock('mermaid', 'graph TD\n', '  A --> B\n'))
    expect(source).toBe('graph TD\n  A --> B')
  })

  test('accepts a space-separated className string as well as hast’s array', () => {
    const source = mermaidDiagramSource({
      type: 'element',
      tagName: 'pre',
      children: [
        {
          type: 'element',
          tagName: 'code',
          properties: { className: 'hljs language-mermaid' },
          children: [{ type: 'text', value: 'graph TD\n  A --> B' }],
        },
      ],
    })
    expect(source).toBe('graph TD\n  A --> B')
  })

  test('leaves every other fenced language to the code renderer', () => {
    expect(mermaidDiagramSource(fencedBlock('typescript', 'const value = 1'))).toBeNull()
    expect(mermaidDiagramSource(fencedBlock(null, 'plain text'))).toBeNull()
    // A language that merely starts with `mermaid` is a different language.
    expect(mermaidDiagramSource(fencedBlock('mermaidjs', 'graph TD'))).toBeNull()
  })

  test('an empty or whitespace-only diagram is not a diagram', () => {
    expect(mermaidDiagramSource(fencedBlock('mermaid', '\n  \n'))).toBeNull()
    expect(mermaidDiagramSource(fencedBlock('mermaid'))).toBeNull()
  })

  test('degrades to null for nodes that are not a fenced block at all', () => {
    expect(mermaidDiagramSource(undefined)).toBeNull()
    expect(mermaidDiagramSource({ type: 'element', tagName: 'p', children: [] })).toBeNull()
    // A `pre` whose first child is not a `code` element (raw preformatted text).
    expect(
      mermaidDiagramSource({
        type: 'element',
        tagName: 'pre',
        children: [{ type: 'text', value: 'graph TD' }],
      }),
    ).toBeNull()
  })
})
