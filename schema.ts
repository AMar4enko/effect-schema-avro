import type { Schema } from 'avsc'
import { Brand, Option } from 'effect'
import { type Branded } from 'effect/Brand'
import * as Data from 'effect/Data'
import * as Effect from 'effect/Effect'
import * as M from 'effect/Match'
import * as S from 'effect/Schema'
import * as AST from 'effect/SchemaAST'
import { ns } from './utils.ts'

export const AvroSchemaBrandId: unique symbol = Symbol.for(ns`Schema`)

class CompileError extends Data.TaggedError(ns`CompileError`) {
  constructor(public message: string) {
    super()
  }
}

export class AvroRegistry extends Effect.Service<AvroRegistry>()(`AvroRegistry`, {
  sync: () => ({}),
}) {}

type AvroSchema = Branded<Schema, typeof AvroSchemaBrandId>
type SchemaMatcher = (ast: AST.AST) => Option.Option<AvroSchema>

const avroSchema = Brand.nominal<AvroSchema>()

const matchElseNone = M.orElse(() => Option.none())

const primitiveTypes: SchemaMatcher = M.type<AST.AST>().pipe(
  M.when(AST.isStringKeyword, (a) => Option.some(avroSchema(`string`))),
  M.when(AST.isBigIntKeyword, () => Option.some(avroSchema(`long`))),
  M.when(AST.isNumberKeyword, () => Option.some(avroSchema(`double`))),
  M.when(AST.isBooleanKeyword, () => Option.some(avroSchema(`boolean`))),
  matchElseNone,
)

const propertySignature = M.type<AST.AST>().pipe(
  M.when(
    (ast) => AST.isTypeLiteral(ast),
    (a) => {
      if (a.propertySignatures.length === 0) {
        return Option.some(
          avroSchema({
            type: `record`,
            name: ``,
            fields: [],
          }),
        )
      }

      return Option.none()

      // const type = a.type
      // return type.match(primitiveTypes)
    },
  ),
  matchElseNone,
)

// const

export const toAvroSchema: <A, I, R>(s: S.Schema<A, I, R>) => Effect.Effect<AvroSchema, CompileError, AvroRegistry> = (
  s,
) => Effect.sync(() => avroSchema(`string`))
