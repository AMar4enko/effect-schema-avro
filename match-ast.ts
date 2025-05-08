import { Chunk, Effect, Option, Pipeable, Record, Schema, SchemaAST, Tuple, flow, identity, pipe } from 'effect'
import { pipeArguments } from 'effect/Pipeable'
import {
  type AST,
  Declaration,
  Enums,
  IndexSignature,
  OptionalType,
  PropertySignature,
  Refinement,
  Suspend,
  TemplateLiteral,
  TemplateLiteralSpan,
  Transformation,
  type TransformationKind,
  TupleType,
  Type,
  TypeLiteral,
  Union,
} from 'effect/SchemaAST'
import type { TupleOf } from 'effect/Types'

export type Matcher<A> = (ast: AST) => Option.Option<A>

export type ApplyMatchers<A extends { [key in keyof A]: A[key] }> = {
  [K in keyof A]: A[K] extends Matcher<infer U> ? U : never
}

export declare namespace Compiler {
  export interface Compiler<A = never, E = never, R = never> extends Pipeable.Pipeable {
    run: (ast: AST) => Effect.Effect<A, E, R>
    compileMatch: <T, A2, E2, R2>(
      predicate: Matcher<T>,
      fn: (match: T, compile: (ast: AST) => Effect.Effect<A, E, R>) => Effect.Effect<A2, E2, R2>,
    ) => Compiler<A | A2, E | E2, R | R2>
  }

  export interface CompilerInternal<A, E = never, R = never> extends Compiler<A, E, R> {
    compile: (ast: AST, compile: this['run']) => Effect.Effect<A, E, R>
  }
}

export const isCompiler = <A, E, R>(value: Compiler.Compiler<A, E, R>): value is Compiler.CompilerInternal<A, E, R> =>
  typeof value === 'object' && value !== null && 'compile' in value

export type MatchTransformation<
  Kind extends TransformationKind['_tag'],
  S extends { from?: Matcher<unknown>; to?: Matcher<unknown> } = never,
> = {
  ast: Transformation
  kind: Extract<TransformationKind, { _tag: Kind }>
  structure: [S] extends [never] ? never : ApplyMatchers<S>
}

export const matchTags = <T extends AST['_tag']>(...tags: T[]) => {
  const s = new Set<string>(tags)
  const predicate = (ast: AST): ast is Extract<AST, { _tag: T }> => s.has(ast._tag)
  const fromPredicate = Option.liftPredicate(predicate)

  return fromPredicate
}

const transformation = matchTags(`Transformation`)

export const matchTransformation = <
  Kind extends TransformationKind['_tag'],
  S extends { from?: Matcher<unknown>; to?: Matcher<unknown> } = never,
>(
  kind: Kind,
  structure?: S,
) => {
  const matchKind = (ast: Transformation) =>
    ast.transformation._tag === kind
      ? Option.some(ast.transformation as Extract<TransformationKind, { _tag: typeof kind }>)
      : Option.none()

  return flow(
    transformation,
    Option.bindTo(`ast`),
    Option.bind(`kind`, ({ ast }) => matchKind(ast)),
    Option.bind(`structure`, ({ ast }) => {
      if (structure === undefined) {
        return Option.some({ ast, kind })
      }
      // biome-ignore lint/suspicious/noExplicitAny: <explanation>
      const s = {} as any
      if (structure.from) {
        s.from = structure.from(ast.from)
      }
      if (structure.to) {
        s.to = structure.to(ast.to)
      }
      return Option.all(s)
    }),
  ) as unknown as Matcher<MatchTransformation<Kind, S>>
}

const proto = Object.freeze({
  compile: (ast: AST) => Effect.fail(new Error(`Not implemented: ${ast}`)),
  pipe: pipeArguments,
  compileMatch<T, A, E, R>(
    // biome-ignore lint/suspicious/noExplicitAny: <explanation>
    this: Compiler.Compiler<any, any, any>,
    predicate: Matcher<T>,
    fn: (match: T, compile: (ast: AST) => Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>,
  ) {
    if (!isCompiler(this)) {
      throw new Error(`Unexpected`)
    }

    const compile = (ast: AST, compile: (ast: AST) => Effect.Effect<A, E, R>) => {
      return predicate(ast).pipe(
        Option.map((t) => fn(t, compile)),
        Option.getOrElse(() => this.compile(ast, compile)),
      )
    }

    const run = (ast: AST) => compile(ast, run)

    return Object.create(proto, {
      compile: {
        value: compile,
        writable: false,
        enumerable: false,
        configurable: false,
      },
      run: {
        value: run,
        writable: false,
        enumerable: false,
        configurable: false,
      },
    })
  },
})

export const make = <A = never>(): Compiler.Compiler<A> => Object.create(proto)

export const map = <A extends AST, B extends AST>(
  predicate: (ast: AST) => Option.Option<A>,
  mapFn: (ast: A, path: readonly PropertyKey[]) => B,
) => {
  const id = (ast: AST) => ast

  const maybeTransform =
    <T extends AST>(fn: (ast: T, compile: SchemaAST.Compiler<AST>, path: readonly PropertyKey[]) => AST) =>
    (ast: T, compile: SchemaAST.Compiler<AST>, path: readonly PropertyKey[]) => {
      const matched = predicate(ast)
      if (matched._tag == `Some`) {
        const newAst = mapFn(matched.value, path)
        if (newAst._tag == ast._tag) {
          return fn(newAst as unknown as T, compile, path)
        }

        return compile(newAst, path)
      }

      return fn(ast, compile, path)
    }

  const branches = Record.map(
    {
      AnyKeyword: id,
      BigIntKeyword: id,
      BooleanKeyword: id,
      NumberKeyword: id,
      ObjectKeyword: id,
      NeverKeyword: id,
      StringKeyword: id,
      SymbolKeyword: id,
      UndefinedKeyword: id,
      UnknownKeyword: id,
      VoidKeyword: id,
      UniqueSymbol: id,
      Enums: id,
      Literal: id,
      Declaration: (ast, compile, path) => {
        return new Declaration(
          ast.typeParameters.map((ast) => compile(ast, path)),
          ast.decodeUnknown,
          ast.encodeUnknown,
          ast.annotations,
        )
      },
      Refinement: (ast, compile, path) => {
        return new Refinement(compile(ast.from, path), ast.filter, ast.annotations)
      },
      Suspend: (ast, compile, path) => {
        return new Suspend(() => compile(ast.f(), path), ast.annotations)
      },
      TemplateLiteral: (ast, compile, path) => {
        return new TemplateLiteral(
          ast.head,
          // biome-ignore lint/suspicious/noExplicitAny: <explanation>
          ast.spans.map((span) => new TemplateLiteralSpan(compile(span.type, path), span.literal)) as any,
        )
      },
      Transformation: (ast, compile, path) => {
        return new Transformation(compile(ast.from, path), compile(ast.to, path), ast.transformation, ast.annotations)
      },
      TupleType: (ast, compile, path) => {
        return new TupleType(
          ast.elements.map(
            (element) => new OptionalType(compile(element.type, path), element.isOptional, element.annotations),
          ),
          ast.rest.map((element) => new Type(compile(element.type, path), element.annotations)),
          ast.isReadonly,
          ast.annotations,
        )
      },
      TypeLiteral: (ast, compile, path) => {
        return new TypeLiteral(
          ast.propertySignatures.map(
            (sig) =>
              new PropertySignature(
                sig.name,
                compile(sig.type, [sig.name, ...path]),
                sig.isOptional,
                sig.isReadonly,
                sig.annotations,
              ),
          ),
          ast.indexSignatures.map(
            (sig) => new IndexSignature(compile(sig.parameter, path), compile(sig.type, path), sig.isReadonly),
          ),
          ast.annotations,
        )
      },
      Union: (ast, compile, path) => {
        return Union.make(
          ast.types.map((type) => compile(type, path)),
          ast.annotations,
        )
      },
    } satisfies SchemaAST.Match<AST>,
    // biome-ignore lint/suspicious/noExplicitAny: <explanation>
    maybeTransform as any,
  ) as unknown as SchemaAST.Match<AST>

  const cmp = SchemaAST.getCompiler(branches)

  return (ast: AST) => cmp(ast, [])
}
