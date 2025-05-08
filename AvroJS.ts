import './avro-js.d.ts'
import type { Schema, Type } from 'avsc'
import * as Effect from 'effect/Effect'
import * as S from 'effect/Schema'

export class AvroJS extends Effect.Service<AvroJS>()(`AvroJS`, {
  // accessors: true,
  effect: Effect.gen(function* () {
    const avroJs = yield* Effect.tryPromise(() => import('avro-js'))

    const parse = (schema: Schema): Type => avroJs.parse(schema)

    return {
      parse,
    }
  }),
}) {
  
}
