import { Option, Schema, SchemaAST, pipe } from 'effect'
import type { AST, Declaration, FinalTransformation, Transformation, TypeLiteral } from 'effect/SchemaAST'
import { describe, expect, test } from 'tstyche'
import * as C from '../compile.js'

describe(`matchTransformation`, () => {
  test(`with From filter`, () => {
    const typeLiteral = C.matchTags(`TypeLiteral`)
    const declaration = C.matchTags(`Declaration`)

    const fromTypeLiteral = C.matchTransformation(`FinalTransformation`, { from: typeLiteral })
    const toTypeLiteral = C.matchTransformation(`FinalTransformation`, { to: typeLiteral })
    const fromTypeLiteralToDeclaration = C.matchTransformation(`FinalTransformation`, {
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
