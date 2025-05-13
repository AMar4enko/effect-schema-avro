import * as avsc from 'avsc'
import { Array, Context, Effect, Match, Option, Record, Schema as S, SchemaAST, flow, pipe } from 'effect'
import { TaggedError } from 'effect/Data'
import { Unexpected } from 'effect/ParseResult'
import { IntSchemaId } from 'effect/Schema'
import { type AST, IdentifierAnnotationId, TitleAnnotationId } from 'effect/SchemaAST'
import * as C from './compile.js'

export const LongSchemaId: unique symbol = Symbol(`@schema-avro/Long`)
export const FloatSchemaId: unique symbol = Symbol(`@schema-avro/Double`)

export const Float = S.Number.pipe(
  S.annotations({
    [SchemaAST.SchemaIdAnnotationId]: FloatSchemaId,
  }),
)

export const Long = S.Number.pipe(
  S.annotations({
    [SchemaAST.SchemaIdAnnotationId]: LongSchemaId,
  }),
)

export const Double = S.Number
export const Int = S.Int

export const Bytes = S.Uint8ArrayFromSelf

export class CompilerRegistry {
  namedTypes = new Map<string, avsc.Type>()
  logicalTypes = new Map<string, typeof avsc.types.LogicalType>()

  getOrLookup(name: string, lookup: () => avsc.Type) {
    if (!this.namedTypes.has(name)) {
      this.namedTypes.set(name, lookup())
    }

    return this.namedTypes.get(name)!
  }
}

export interface CompilerState {
  registry: CompilerRegistry
  state: Option.Option<{ _tag: `Declaration`; id: string }>
}

const getDeclarationState = ({ state }: CompilerState) =>
  state.pipe(Option.filter(({ _tag }) => _tag === `Declaration`))

export const getDeclaration = (harness: C.Compiler.Harness<avsc.Type, CompilerState>) =>
  getDeclarationState(harness.getState()).pipe(Option.map(({ id }) => id))

const matchScalars = C.matchTags(
  `StringKeyword`,
  `NumberKeyword`,
  `BooleanKeyword`,
  `UndefinedKeyword`,
  `NeverKeyword`,
  `UnknownKeyword`,
  `AnyKeyword`,
)

const matchDeclaration = C.matchTags(`Declaration`)
const matchTypeLiteral = C.matchTags(`TypeLiteral`)

const matchUint8Array = flow(
  matchDeclaration,
  Option.tap((decl) =>
    SchemaAST.getAnnotation(IdentifierAnnotationId)(decl).pipe(
      Option.tap(Option.liftPredicate((s) => s === `Uint8ArrayFromSelf`)),
    ),
  ),
)

/**
 *  We shouldn't really try reveal the fact it's a class,
 *  gonna keep it for sake of clarity anyway for the time being
 */
const matchClass = C.matchTransformation(`FinalTransformation`, {
  from: matchTypeLiteral,
  to: (ast: AST) =>
    Option.gen(function* () {
      const decl = yield* matchDeclaration(ast)

      const identifiedTypeLiteral = yield* Option.zipLeft(
        SchemaAST.getIdentifierAnnotation(decl),
        matchTypeLiteral(decl.typeParameters[0]),
      )

      return identifiedTypeLiteral
    }),
})

class Unsupported extends Error {}
class MissingIdentifier extends Error {
  ast: SchemaAST.AST

  constructor(ast: SchemaAST.AST, message = `Missing identifier`) {
    super(message)
    this.ast = ast
  }
}

const getSchemaId = SchemaAST.getAnnotation(SchemaAST.SchemaIdAnnotationId)

const getNumberType = Match.type<unknown>().pipe(
  Match.when(IntSchemaId, () => `int` as const),
  Match.when(FloatSchemaId, () => `float` as const),
  Match.when(LongSchemaId, () => `long` as const),
  Match.orElse(() => `double` as const),
)

// class PropertySignatureContext extends Context.Tag(`PropertySignatureState`)<
//   PropertySignatureContext,
//   { name: PropertyKey; isOptional: boolean; isReadonly: boolean }
// >() {}

export type CompileContext = { _tag: `Declaration`; id: string }

// const CompileContext = Context.GenericTag<CompileContext>(`@schema-avro/CompileContext`)
const filterCompileContext =
  <A extends CompileContext['_tag']>(tag: A) =>
  (decl: CompileContext) =>
    Option.fromNullable(decl._tag === tag ? decl : null) as Option.Option<Extract<CompileContext, { _tag: A }>>

// const getCompileContext = Effect.contextWithEffect((ctx: Context.Context<never>) =>
//   Context.getOption(CompileContext)(ctx),
// )

/**
 * Creates codec for AVRO record, removing _tag field during encoding and adding it back during decoding.
 */
const createAmbientTagLogicalType = (tag: string) => {
  return class VanishTagLogicalType extends avsc.types.LogicalType {
    toString() {
      return `AmbientTag[${tag}]`
    }
    // biome-ignore lint/suspicious/noExplicitAny: <explanation>
    _fromValue(val: any) {
      return {
        ...val,
        _tag: tag,
      }
    }

    // biome-ignore lint/suspicious/noExplicitAny: <explanation>
    _toValue(val: any) {
      delete val._tag
      return val
    }
    _resolve(type: avsc.Type) {
      return this._fromValue
    }
  }
}

export const requestAmbientTag = (harness: C.Compiler.Harness<avsc.Type, CompilerState>, tag: string) => {
  return harness.modifyState((state) => {
    if (!state.registry.logicalTypes.has(`Tag_${tag}`)) {
      state.registry.logicalTypes.set(`Tag_${tag}`, createAmbientTagLogicalType(tag))
    }

    return [`Tag_${tag}`, state]
  })
}

const compiler = pipe(
  C.make<avsc.Type, CompilerState>(),
  C.compileMatch(matchScalars, function compileScalar(ast) {
    switch (ast._tag) {
      case `StringKeyword`:
        return avsc.Type.forSchema({ type: `string` })

      case `NumberKeyword`:
        return getSchemaId(ast).pipe(
          Option.map(getNumberType),
          Option.match({
            onNone: () => avsc.Type.forSchema({ type: `double` }),
            onSome: (primitiveType) => avsc.Type.forSchema({ type: primitiveType }),
          }),
        )

      case `BooleanKeyword`:
        return avsc.Type.forSchema({ type: `boolean` })

      default:
        throw new Unsupported(`Unsupported scalar: ${ast._tag}`)
    }
  }),
  C.compileMatch(matchTypeLiteral, function compileTypeLiteral(ast, harness) {
    const declId = getDeclaration(harness)
      .pipe(Option.orElse(() => SchemaAST.getIdentifierAnnotation(ast)))
      .pipe(Option.getOrThrowWith(() => new MissingIdentifier(ast)))

    const logicalType = requestAmbientTag(harness, declId)

    return harness.modifyState((state) => {
      const type = state.registry.getOrLookup(declId, () => {
        const fields: avsc.schema.RecordType['fields'] = ast.propertySignatures
          .map((sig) => {
            if (sig.name === `_tag` && sig.type._tag === `Literal`) {
              return false
            }
            return {
              name: String(sig.name),
              type: harness.compile(sig.type),
            }
          })
          .filter(Boolean)

        return avsc.Type.forSchema(
          { type: `record`, name: declId, fields, logicalType: logicalType },
          { logicalTypes: Object.fromEntries(state.registry.logicalTypes) },
        )
      })

      return [type, state]
    })
  }),
  C.compileMatch(matchClass, function compileClass({ structure: { from, to: classId } }, harness) {
    return harness.withState(
      ({ registry }) => ({ registry, state: Option.some({ _tag: `Declaration`, id: classId }) }),
      () => harness.compile(from),
    )
  }),
  C.compileMatch(C.matchTags(`Suspend`), function compileSuspend(ast, { compile }) {
    return compile(ast.f())
  }),
  C.compileMatch(matchUint8Array, function compileBytes(ast) {
    return avsc.Type.forSchema({ type: `bytes` })
  }),
  C.compileMatch(C.matchTags(`Literal`), function compileLiteral(ast) {
    return avsc.Type.forSchema({ type: `enum`, name: String(ast.literal), symbols: [String(ast.literal)] })
  }),
  C.compileMatch(C.matchTags(`Union`), function compileUnion(ast, { compile }) {
    if (Array.every(ast.types, SchemaAST.isLiteral)) {
      const name = SchemaAST.getIdentifierAnnotation(ast).pipe(
        Option.getOrThrowWith(() => new MissingIdentifier(ast, `Literal union requires identifier`)),
      )
      return avsc.Type.forSchema({
        type: `enum`,
        name,
        symbols: ast.types.map((t) => String((t as SchemaAST.Literal).literal)),
      })
    }

    const unionTypes = compile([...ast.types])

    if (Array.some(unionTypes, (t) => t.typeName === `Union`)) {
      throw new Unexpected(null, `Union types cannot be directly nested`)
    }

    return avsc.Type.forTypes(unionTypes)
  }),
)

// const compiler = C.make<CompilerOutput>()
//   .compileMatch(
//     matchScalars,
//     Effect.fn(`compileScalar`)(function* (ast) {
//       switch (ast._tag) {
//         case `StringKeyword`:
//           return primitive(`string`)

//         case `NumberKeyword`:
//           return getSchemaId(ast).pipe(
//             Option.map(getNumberType),
//             Option.getOrElse(() => `double` as const),
//             primitive,
//           )

//         case `BooleanKeyword`:
//           return primitive(`boolean`)

//         default:
//           return yield* new Unsupported({ message: `Unsupported scalar: ${ast._tag}` })
//       }
//     }),
//   )
//   .compileMatch(
//     matchTypeLiteral,
//     Effect.fn(`compileTypeLiteral`)(function* (ast, compile) {
//       const id = yield* getCompileContext.pipe(
//         Effect.andThen(filterCompileContext(`Declaration`)),
//         Effect.map(({ id }) => id),
//         Effect.orElse(() => SchemaAST.getAnnotation<string>(SchemaAST.IdentifierAnnotationId)(ast)),
//         Effect.mapError(() => new MissingIdentifier({ message: `No identifier found`, ast })),
//       )

//       yield* CompilerRegistry.accessLogicalType((types) => {
//         if (!types.has(`Tag_${id}`)) {
//           types.set(`Tag_${id}`, createAmbientTagLogicalType(id))
//         }
//         return Effect.void
//       })

//       return yield* CompilerRegistry.getOrLookup(
//         id,
//         Effect.gen(function* () {
//           const fields = yield* Effect.all(
//             ast.propertySignatures
//               .map((sig) => {
//                 if (sig.name === `_tag` && sig.type._tag === `Literal`) {
//                   return false
//                 }

//                 return compile(sig.type).pipe(
//                   Effect.provideService(PropertySignatureContext, {
//                     name: sig.name,
//                     isOptional: sig.isOptional,
//                     isReadonly: sig.isReadonly,
//                   }),
//                   Effect.map((field) => [sig.name, field] as const),
//                 )
//               })
//               .filter(Boolean),
//           )

//           return record(id, Object.fromEntries(fields), {
//             aliases: Option.none(),
//             doc: Option.none(),
//             namespace: Option.none(),
//           })
//         }),
//       )
//     }),
//   )
//   .compileMatch(
//     matchClass,
//     Effect.fn(`compileClass`)(function* ({ structure: { from, to: classId } }, compile) {
//       return yield* compile(from).pipe(Effect.provideService(CompileContext, { _tag: `Declaration`, id: classId }))
//     }),
//   )
//   .compileMatch(
//     C.matchTags(`Suspend`),
//     Effect.fn(`compileSuspend`)(function* (ast, compile) {
//       return yield* compile(ast.f())
//     }),
//   )
//   .compileMatch(
//     matchUint8Array,
//     Effect.fn(`compileBytes`)(function* (ast) {
//       return primitive(`bytes`)
//     }),
//   )
//   .compileMatch(
//     C.matchTags(`Literal`),
//     Effect.fn(`compileLiteral`)(function* (ast) {
//       return primitive(`string`)
//     }),
//   )
//   .compileMatch(
//     C.matchTags(`Union`),
//     Effect.fn(`compileUnion`)(function* (ast, compile) {
//       const types = yield* Effect.all(ast.types.map(compile)).pipe(
//         Effect.tap((types) => {
//           if (Array.some(types, (t) => t._tag === `Union`)) {
//             return Effect.fail(new Unexpected(null, `Union types cannot be directly nested`))
//           }

//           return Effect.void
//         }),
//       )

//       return union(types as unknown as Exclude<CompilerOutput, { _tag: `Union` }>[])
//     }),
//   )

const Buffer: S.Schema<Buffer, Buffer> = S.make(
  new SchemaAST.AnyKeyword({
    [TitleAnnotationId]: `Buffer`,
  }),
)

export type AvroFactory<A, I, R> = (s: S.Schema<A, I, R>) => S.Schema<A, Buffer, R> & {
  avro: avsc.Schema
}

export type AvroEvolve<A, I, R> = { schema: S.Schema<A, I, R>; test: (a: A) => boolean }

export class AvroError extends TaggedError(`AvroError`)<{ message: string }> {}
export class AvroEvolveTestError extends Unexpected {
  message = `Light type failed test before evolve`
}

export const avro = <A, I, R, EvA = never, EvI = never>(
  s: S.Schema<A, I, R>,
  options?: { evolve: AvroEvolve<EvA, EvI, never> },
) => {
  const [type, state] = compiler.run(s.ast, {
    registry: new CompilerRegistry(),
    state: Option.none(),
  })

  const evolve = Option.fromNullable(options?.evolve)

  const decode = evolve.pipe(
    Option.map(({ schema, test }) =>
      pipe(compiler.run(s.ast, state), ([lightType]) => {
        const resolver = lightType.createResolver(type)
        const decodeLight = S.decodeUnknownSync(schema)

        return (a: Buffer) =>
          Effect.try({
            try: () => {
              const decoded = lightType.fromBuffer(a, resolver, true)
              if (test(decodeLight(decoded))) {
                return type.fromBuffer(a)
              }
              throw new AvroEvolveTestError(a)
            },
            catch: (e) => {
              if (e instanceof AvroEvolveTestError) {
                return e
              }

              return new Unexpected(null, `Error during type evolution:\n${String(e)}`)
            },
          })
      }),
    ),
    Option.getOrElse(
      () => (a: Buffer) =>
        Effect.try({
          try() {
            return type.fromBuffer(a)
          },
          catch(e) {
            return new Unexpected(null, `Error during type evolution:\n${String(e)}`)
          },
        }),
    ),
  )

  return S.transformOrFail(Buffer, s, {
    decode,
    encode: (a) => Effect.sync(() => type.toBuffer(a)),
    strict: false,
  }) as S.Schema<A, Buffer, R>
}

export { compiler }
