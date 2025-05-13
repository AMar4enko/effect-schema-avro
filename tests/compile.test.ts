import { describe, expect, test } from 'bun:test'
import { Option, Schema, SchemaAST } from 'effect'
import { pipe } from 'effect'
import * as C from '../compile.js'

describe(`Compiler`, () => {
  test(`basic`, () => {
    const c = pipe(
      C.make<number, string>(),
      C.compileMatch(Option.liftPredicate(SchemaAST.isStringKeyword), (match, { modifyState }) => {
        modifyState(() => [1, `string`])

        return 1
      }),
      C.compileMatch(Option.liftPredicate(SchemaAST.isNumberKeyword), (match, { modifyState }) => {
        modifyState(() => [2, `number`])

        return 2
      }),
      C.compileMatch(Option.liftPredicate(SchemaAST.isTypeLiteral), (match, { withState, compile }) => {
        const compileProps = () => match.propertySignatures.reduce((acc, prop) => acc + compile(prop.type), 0)

        return withState((state) => `inner-state`, compileProps)
      }),
    )

    const s = Schema.Struct({
      field1: Schema.String,
      field2: Schema.Number,
      field3: Schema.Number,
    })

    expect(c.run(s.ast, `init`)).toEqual([5, `init`])
  })
})
