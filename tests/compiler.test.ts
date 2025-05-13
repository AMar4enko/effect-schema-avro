import { describe, test } from 'bun:test'
import { SchemaAST as AST, Option, Schema, pipe } from 'effect'
import * as C from '../compiler.js'

describe(`Compiler`, () => {
  test(`basic scenario`, () => {
    const a = C.make<AST.AST, string, number>()
    const comp = pipe(
      a,
      C.compileMatch(Option.liftPredicate(AST.isStringKeyword), function* (ast, { getState, modifyState, compile }) {
        const idx = yield* modifyState((s) => s + 1)

        return `string[${idx}]`
      }),
      C.compileMatch(Option.liftPredicate(AST.isTypeLiteral), function* (ast, { getState, compile, modifyState }) {
        const idx = yield* modifyState((s) => s + 1)
        const propAsts = yield* compile(ast.propertySignatures.map((p) => p.type))

        return `{\n${ast.propertySignatures.map((p, idx) => `${String(p.name)}: ${propAsts[idx]}`).join(`\n`)}\n}`
      }),
    )

    const input = Schema.Struct({
      name: Schema.String,
      // age: Schema.Number,
      email: Schema.String,
    })

    const result = pipe(comp, C.run(input.ast, 0))

    console.log(`!!!!!!!`, result)
  })
})
