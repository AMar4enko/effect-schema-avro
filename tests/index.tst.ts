import { Effect, Option, Schema, SchemaAST, pipe } from 'effect'
import type { AST, Declaration, FinalTransformation, Transformation, TypeLiteral } from 'effect/SchemaAST'
import { describe, expect, test } from 'tstyche'
import * as C from '../compiler.js'
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

describe(`compiler`, () => {
  test(`should compile`, () => {
    const c = pipe(
      C.make<SchemaAST.AST, string, number>(),
      C.compileMatch(Option.liftPredicate(SchemaAST.isStringKeyword), function* (match, { compile, modifyState }) {
        // const a = yield* compile(Schema.String.ast)
        const newState = yield* modifyState((state) => state + 1)

        const a = yield* compile(Schema.String.ast)

        return `1`
      }),
    )

    // pipe(
    //   C.make<SchemaAST.AST, number>(),
    //   C.compileMatch(Option.liftPredicate(SchemaAST.isStringKeyword), function* (match, compile) {}),
    // )

    // C.compileMatch(
    //   Option.liftPredicate(SchemaAST.isStringKeyword),
    //   function* (match, compile) {

    //   }
    // )(c)
  })
})

Effect.succeed(1).pipe(Effect.withSpan(`Test`))
