import { expect, it, layer } from '@effect/vitest'
import * as Arb from 'effect/Arbitrary'
import * as Effect from 'effect/Effect'
import * as fastcheck from 'effect/FastCheck'
import * as S from 'effect/Schema'
import { AvroJS } from '../AvroJS.ts'
import { AvroRegistry, toAvroSchema } from '../schema.ts'

const testLayer = layer(AvroJS.Default)

export const testRoundTrip = <A, I, R>(s: S.Schema<A, I, R>) =>
  testLayer((it) =>
    it.scoped(`encode-decode result matches original`, (ctx) =>
      Effect.gen(function* () {
        const { parse } = yield* AvroJS
        const avroSchema = yield* toAvroSchema(s).pipe(Effect.provide(AvroRegistry.Default))
        const type = parse(avroSchema)

        const arb = Arb.make(s)

        const [sample] = fastcheck.sample(arb, 1)

        expect(type.fromBuffer(type.toBuffer(sample))).toEqual(sample)
      }),
    ),
  )
