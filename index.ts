import * as avsc from 'avsc'
import { Array, Context, Effect, Match, Option, Record, Schema as S, SchemaAST, flow, pipe } from 'effect'
import { TaggedError } from 'effect/Data'
import { Unexpected } from 'effect/ParseResult'
import { IntSchemaId } from 'effect/Schema'
import { type AST, IdentifierAnnotationId, TitleAnnotationId } from 'effect/SchemaAST'
import * as C from './match-ast.js'

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

export type AvroRecord = {
  _tag: `Record`
  name: string
  fields: Record<string, CompilerOutput>
  namespace: Option.Option<string>
  doc: Option.Option<string>
  aliases: Option.Option<string[]>
}

export type AvroPrimitive = {
  _tag: `Primitive`
  type: `boolean` | `int` | `long` | `float` | `double` | `bytes` | `string` | `null`
  logicalType?: string
}

export type AvroFixed = {
  _tag: `Fixed`
  name: string
  size: number
}

export type AvroUnion = {
  _tag: `Union`
  type: (AvroRecord | AvroPrimitive | AvroFixed)[]
}

export type CompilerOutput = AvroRecord | AvroPrimitive | AvroFixed | AvroUnion

export class CompilerRegistryImpl {
  namedTypes = new Map<string, CompilerOutput>()
  logicalTypes = new Map<string, typeof avsc.types.LogicalType>()
}

export class CompilerRegistry extends Context.Reference<CompilerRegistryImpl>()(`CompilerRegistry`, {
  defaultValue: () => new CompilerRegistryImpl(),
}) {
  static getOrLookup<E, R>(
    name: string,
    lookup: Effect.Effect<CompilerOutput, E, R>,
  ): Effect.Effect<CompilerOutput, E, R> {
    return CompilerRegistry.pipe(
      Effect.andThen((reg) =>
        Effect.fromNullable(reg.namedTypes.get(name)).pipe(
          Effect.orElse(() => lookup.pipe(Effect.tap((res) => Effect.sync(() => reg.namedTypes.set(name, res))))),
        ),
      ),
    )
  }

  static getAllLogicalTypes = CompilerRegistry.pipe(Effect.map((reg) => Object.fromEntries(reg.logicalTypes.entries())))

  static accessLogicalType = <A, E, R>(
    fn: (types: Map<string, typeof avsc.types.LogicalType>) => Effect.Effect<A, E, R>,
  ) => CompilerRegistry.pipe(Effect.flatMap((reg) => fn(reg.logicalTypes)))
}

const primitive = (
  type: Extract<CompilerOutput, { _tag: `Primitive` }>['type'],
  opts?: { logicalType?: string },
): CompilerOutput => ({
  _tag: `Primitive`,
  type,
  logicalType: opts?.logicalType,
})

const record = (
  name: string,
  fields: Record<string, CompilerOutput>,
  attrs: {
    namespace: Option.Option<string>
    doc: Option.Option<string>
    aliases: Option.Option<string[]>
  },
): CompilerOutput => ({
  _tag: `Record`,
  name,
  fields,
  namespace: attrs.namespace,
  doc: attrs.doc,
  aliases: attrs.aliases,
})

const fixed = (name: string, size: number): CompilerOutput => ({
  _tag: `Fixed`,
  name,
  size,
})

const union = (type: Exclude<CompilerOutput, { _tag: `Union` }>[]): CompilerOutput => ({
  _tag: `Union`,
  type,
})

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

class Unsupported extends TaggedError(`Unsupported`)<{ message: string }> {}
class MissingIdentifier extends TaggedError(`MissingIdentifier`)<{ message: string; ast: SchemaAST.AST }> {}

const getSchemaId = SchemaAST.getAnnotation(SchemaAST.SchemaIdAnnotationId)

const getNumberType = Match.type<unknown>().pipe(
  Match.when(IntSchemaId, () => `int` as const),
  Match.when(FloatSchemaId, () => `float` as const),
  Match.when(LongSchemaId, () => `long` as const),
  Match.orElse(() => `double` as const),
)

class PropertySignatureContext extends Context.Tag(`PropertySignatureState`)<
  PropertySignatureContext,
  { name: PropertyKey; isOptional: boolean; isReadonly: boolean }
>() {}

export type CompileContext = { _tag: `Declaration`; id: string }

const CompileContext = Context.GenericTag<CompileContext>(`@schema-avro/CompileContext`)
const filterCompileContext =
  <A extends CompileContext['_tag']>(tag: A) =>
  (decl: CompileContext) =>
    Option.fromNullable(decl._tag === tag ? decl : null) as Option.Option<Extract<CompileContext, { _tag: A }>>

const getCompileContext = Effect.contextWithEffect((ctx: Context.Context<never>) =>
  Context.getOption(CompileContext)(ctx),
)

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
const compiler = C.make<CompilerOutput>()
  .compileMatch(
    matchScalars,
    Effect.fn(`compileScalar`)(function* (ast) {
      switch (ast._tag) {
        case `StringKeyword`:
          return primitive(`string`)

        case `NumberKeyword`:
          return getSchemaId(ast).pipe(
            Option.map(getNumberType),
            Option.getOrElse(() => `double` as const),
            primitive,
          )

        case `BooleanKeyword`:
          return primitive(`boolean`)

        default:
          return yield* new Unsupported({ message: `Unsupported scalar: ${ast._tag}` })
      }
    }),
  )
  .compileMatch(
    matchTypeLiteral,
    Effect.fn(`compileTypeLiteral`)(function* (ast, compile) {
      const id = yield* getCompileContext.pipe(
        Effect.andThen(filterCompileContext(`Declaration`)),
        Effect.map(({ id }) => id),
        Effect.orElse(() => SchemaAST.getAnnotation<string>(SchemaAST.IdentifierAnnotationId)(ast)),
        Effect.mapError(() => new MissingIdentifier({ message: `No identifier found`, ast })),
      )

      yield* CompilerRegistry.accessLogicalType((types) => {
        if (!types.has(`Tag_${id}`)) {
          types.set(`Tag_${id}`, createAmbientTagLogicalType(id))
        }
        return Effect.void
      })

      return yield* CompilerRegistry.getOrLookup(
        id,
        Effect.gen(function* () {
          const fields = yield* Effect.all(
            ast.propertySignatures
              .map((sig) => {
                if (sig.name === `_tag` && sig.type._tag === `Literal`) {
                  return false
                }

                return compile(sig.type).pipe(
                  Effect.provideService(PropertySignatureContext, {
                    name: sig.name,
                    isOptional: sig.isOptional,
                    isReadonly: sig.isReadonly,
                  }),
                  Effect.map((field) => [sig.name, field] as const),
                )
              })
              .filter(Boolean),
          )

          return record(id, Object.fromEntries(fields), {
            aliases: Option.none(),
            doc: Option.none(),
            namespace: Option.none(),
          })
        }),
      )
    }),
  )
  .compileMatch(
    matchClass,
    Effect.fn(`compileClass`)(function* ({ structure: { from, to: classId } }, compile) {
      return yield* compile(from).pipe(Effect.provideService(CompileContext, { _tag: `Declaration`, id: classId }))
    }),
  )
  .compileMatch(
    C.matchTags(`Suspend`),
    Effect.fn(`compileSuspend`)(function* (ast, compile) {
      return yield* compile(ast.f())
    }),
  )
  .compileMatch(
    matchUint8Array,
    Effect.fn(`compileBytes`)(function* (ast) {
      return primitive(`bytes`)
    }),
  )
  .compileMatch(
    C.matchTags(`Literal`),
    Effect.fn(`compileLiteral`)(function* (ast) {
      return primitive(`string`)
    }),
  )
  .compileMatch(
    C.matchTags(`Union`),
    Effect.fn(`compileUnion`)(function* (ast, compile) {
      const types = yield* Effect.all(ast.types.map(compile)).pipe(
        Effect.tap((types) => {
          if (Array.some(types, (t) => t._tag === `Union`)) {
            return Effect.fail(new Unexpected(null, `Union types cannot be directly nested`))
          }

          return Effect.void
        }),
      )

      return union(types as unknown as Exclude<CompilerOutput, { _tag: `Union` }>[])
    }),
  )

const outputToSchema: (output: CompilerOutput) => Effect.Effect<avsc.Type, never, never> =
  Match.type<CompilerOutput>().pipe(
    Match.tag(`Union`, ({ type }) => {
      return Effect.all(type.map(outputToSchema)).pipe(Effect.map(avsc.Type.forTypes))
    }),
    Match.tag(`Primitive`, ({ type, logicalType }) => {
      return CompilerRegistry.getAllLogicalTypes.pipe(
        Effect.map((logicalTypes) => avsc.Type.forSchema({ type, logicalType }, { logicalTypes }) as avsc.Type),
      )
    }),
    Match.tag(`Fixed`, ({ name, size }) => {
      return CompilerRegistry.getAllLogicalTypes.pipe(
        Effect.map(
          (logicalTypes) =>
            avsc.Type.forSchema(
              {
                type: `fixed`,
                name,
                size,
              },
              { logicalTypes },
            ) as avsc.Type,
        ),
      )
    }),
    Match.tag(`Record`, ({ name, fields }) => {
      return CompilerRegistry.getAllLogicalTypes.pipe(
        Effect.bindTo(`logicalTypes`),
        Effect.bind(`fields`, () =>
          Effect.all(
            Object.entries(fields).map(([name, field]) =>
              outputToSchema(field).pipe(
                Effect.andThen((a) => ({
                  name,
                  type: a,
                })),
              ),
            ),
          ),
        ),
        Effect.map(({ logicalTypes, fields }) =>
          avsc.Type.forSchema(
            {
              name,
              type: `record`,
              fields,
              logicalType: `Tag_${name}`,
            },
            {
              logicalTypes,
            },
          ),
        ),
      )
    }),
    Match.orElseAbsurd,
  )

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
) =>
  Effect.gen(function* () {
    const astWithoutTags = C.map(Option.liftPredicate(SchemaAST.isLiteral), (ast, path) => {
      if (path[0] === `_tag`) {
        return new SchemaAST.AnyKeyword()
      }
      return ast
    })(s.ast)

    const type = yield* pipe(compiler.run(s.ast), Effect.flatMap(outputToSchema))
    const evolve = Option.fromNullable(options?.evolve)

    const decode = yield* evolve.pipe(
      Option.map(({ schema: lightSchema, test }) =>
        pipe(
          compiler.run(lightSchema.ast),
          Effect.flatMap(outputToSchema),
          Effect.map((lightType) => {
            const resolver = lightType.createResolver(type)
            const decodeLight = S.decodeUnknownSync(lightSchema, { exact: false, onExcessProperty: `preserve` })
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
      ),
      Option.getOrElse(() =>
        Effect.succeed((a: Buffer) =>
          Effect.try({
            try() {
              return type.fromBuffer(a)
            },
            catch(e) {
              return new Unexpected(null, `Error during type evolution:\n${String(e)}`)
            },
          }),
        ),
      ),
    )

    return S.transformOrFail(Buffer, s, {
      decode,
      encode: (a) => Effect.sync(() => type.toBuffer(a)),
      strict: false,
    }) as S.Schema<A, Buffer, R>
  })

export { compiler }
