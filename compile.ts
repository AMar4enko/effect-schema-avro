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
  export type Output<A, S> = A

  export interface Harness<A, State> {
    compile: <T extends AST | AST[]>(ast: T) => [T] extends [AST] ? A : A[]
    getState: () => State
    modifyState: <A>(fn: (state: State) => [A, State]) => A
    withState: (f: (state: State) => State, run: () => Output<A, State>) => Output<A, State>
  }

  export interface Compiler<A, State> extends Pipeable.Pipeable {
    run: (ast: AST, initialState: State) => [A, State]
  }

  export interface CompilerInternal<A, State> extends Compiler<A, State> {
    compile: (ast: AST, compiler: Harness<A, State>) => Output<A, State>
  }

  // biome-ignore lint/suspicious/noExplicitAny: <explanation>
  export type AnyCompiler = Compiler<any, any>
}

export const isCompiler = <A, State>(
  value: Compiler.Compiler<A, State>,
): value is Compiler.CompilerInternal<A, State> => typeof value === 'object' && value !== null && 'compile' in value

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
  compile(ast: AST) {
    throw new Error(`Not implemented: ${ast}`)
  },
  // biome-ignore lint/suspicious/noExplicitAny: <explanation>
  run(this: Compiler.AnyCompiler, ast: AST, initialState: any) {
    if (!isCompiler(this)) {
      throw new Error(`Unexpected`)
    }
    let state: unknown = initialState

    const getState = () => state
    const modifyState = <A>(f: (state: unknown) => [A, unknown]) => {
      const [a, newState] = f(state)
      state = newState
      return a
    }

    const compile = (ast: AST | AST[]) => {
      const withState = (f: (state: unknown) => unknown, run: () => unknown) => {
        const oldState = state
        state = f(state)
        const result = run()
        state = oldState
        return result
      }

      if (Array.isArray(ast)) {
        return ast.map((ast) => this.compile(ast, { getState, modifyState, withState, compile }))
      }

      return this.compile(ast, { getState, modifyState, withState, compile })
    }

    return [compile(ast), state]
  },
  pipe: pipeArguments,
})

export const make = <A, State>(): Compiler.Compiler<A, State> => Object.create(proto)

export const compileMatch =
  <T, A, B, State>(
    predicate: Matcher<T>,
    fn: (match: T, compile: Compiler.Harness<A, State>) => Compiler.Output<B, State>,
  ) =>
  (compiler: Compiler.Compiler<A, State>): Compiler.Compiler<A | B, State> =>
    Object.create(compiler, {
      compile: {
        // biome-ignore lint/suspicious/noExplicitAny: <explanation>
        value: (ast: AST, compile: Compiler.Harness<any, any>) => {
          const res = predicate(ast)
          if (res._tag == `Some`) {
            return fn(res.value, compile)
          }

          return (compiler as Compiler.CompilerInternal<A, State>).compile(ast, compile)
        },
      },
    })

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
