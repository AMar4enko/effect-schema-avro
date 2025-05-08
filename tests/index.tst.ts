import { Option } from 'effect'
import type { AST, Declaration, FinalTransformation, Transformation, TypeLiteral } from 'effect/SchemaAST'
import { describe, expect, test } from 'tstyche'
import * as M from '../match-ast.js'

describe(`matchTransformation`, () => {
  test(`with From filter`, () => {
    const typeLiteral = M.matchTags(`TypeLiteral`)
    const declaration = M.matchTags(`Declaration`)

    const fromTypeLiteral = M.matchTransformation(`FinalTransformation`, { from: typeLiteral })
    const toTypeLiteral = M.matchTransformation(`FinalTransformation`, { to: typeLiteral })
    const fromTypeLiteralToDeclaration = M.matchTransformation(`FinalTransformation`, {
      from: typeLiteral,
      to: declaration,
    })

    expect(fromTypeLiteral).type.toBe<
      (ast: AST) => Option.Option<{ ast: Transformation; kind: FinalTransformation; structure: { from: TypeLiteral } }>
    >()

    expect(fromTypeLiteralToDeclaration).type.toBe<
      (ast: AST) => Option.Option<{
        ast: Transformation
        kind: FinalTransformation
        structure: { from: TypeLiteral; to: Declaration }
      }>
    >()

    expect(toTypeLiteral).type.toBe<
      (ast: AST) => Option.Option<{ ast: Transformation; kind: FinalTransformation; structure: { to: TypeLiteral } }>
    >()
  })
})
