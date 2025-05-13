import { describe, expect, it } from '@effect/vitest'
import * as avsc from 'avsc'
import { Effect, Schema as S } from 'effect'
import { parseJson } from 'effect/Schema'
import { avro } from '../index.js'
import { Content, Post, User } from './fixtures/index.js'

const postsEqual = S.equivalence(Post)

describe(`Avro compiler`, () => {
  describe.only(`basic features`, () => {
    it.effect(`fixtures`, () =>
      Effect.gen(function* () {
        // const PostAvro = yield* avro(Post)
        // const encodePost = S.encodeSync(PostAvro)
        // const decodePost = S.decodeSync(PostAvro)
        // const newPost = new Post({
        //   id: 1,
        //   author: new User({ name: `John Doe`, id: 1, email: `john.doe@example.com` }),
        // })
        // const buffer = encodePost(newPost)
        // const decodedPost = decodePost(buffer)
        // expect(postsEqual(newPost, decodedPost)).toBe(true)
      }),
    )

    it.effect(`schema evolution`, () =>
      Effect.gen(function* () {
        const heavyType = avsc.Type.forSchema({
          name: 'Event',
          type: 'record',
          fields: [
            { name: 'time', type: 'long' },
            { name: 'userId', type: 'int' },
            { name: 'actions', type: { type: 'array', items: 'string' } },
          ],
        })
        const lightType = avsc.Type.forSchema({
          name: 'LightEvent',
          // aliases: ['Event1'],
          type: 'record',
          fields: [{ name: 'userId', type: 'int' }],
        })

        const buffer = heavyType.toBuffer({ time: 123, userId: 1, actions: [`a`, `b`] })
        const resolver = lightType.createResolver(heavyType)
        const decoded = lightType.fromBuffer(buffer, resolver, true)
        console.log(decoded)
        expect(decoded).toEqual({ userId: 1 })

        // const Id = S.Struct({ id: Post.fields.id }).pipe(S.annotations({ identifier: `Identifiable` }))
        // const newPost = new Post({
        //   id: 1,
        //   test: `test`,
        //   // author: new User({ name: `John Doe`, id: 1, email: `john.doe@example.com` }),
        // })
        // const PostAvro = yield* avro(Post, {
        //   evolve: {
        //     schema: Id,
        //     test: (a) => {
        //       console.log(JSON.stringify(a, null, 2))
        //       return a.id === 1
        //     },
        //   },
        // })
        // const encodePost = S.encodeSync(PostAvro)
        // const decodePost = S.decodeSync(PostAvro)
        // expect(postsEqual(newPost, decodePost(encodePost(newPost)))).toBe(true)
      }),
    )
  })
  describe(`named and tagged types`, () => {
    /**
     * In JSON world object are anonymous, hence the need for _tag.
     * In AVRO world, records are always named, thus in AVRO binary format there is no need for _tag.
     * We eliminate _tag property during AVRO encoding and bring it back during decoding.
     */
    it.effect(`Tagged types are serialized without _tag`, () =>
      Effect.gen(function* () {
        const TestStruct = S.TaggedStruct(`TestStruct`, {}).pipe(S.annotations({ identifier: `TestStruct` }))
        const TestStructAvro = yield* avro(TestStruct)

        const encodeContent = S.encodeSync(TestStructAvro)
        const decodeContent = S.decodeSync(TestStructAvro)

        const buffer = encodeContent({ _tag: `TestStruct` })
        const decodedContent = decodeContent(buffer)

        expect(decodedContent._tag).toEqual(`TestStruct`)
        expect(buffer.byteLength).toEqual(0)
      }),
    )
  })
  describe(`union types`, () => {
    it.effect(`union types are serialized as union`, () =>
      Effect.gen(function* () {
        const Union = yield* S.Union(Post, User).pipe(avro)

        const encodeUnion = S.encodeSync(Union)
        const decodeUnion = S.decodeSync(Union)

        const source = new Post({ id: 1, author: new User({ name: `John Doe`, id: 1, email: `john.doe@example.com` }) })

        const buffer = encodeUnion(source)
        const decoded = decodeUnion(buffer)

        expect(decoded).toEqual(source)
      }),
    )
  })
})
