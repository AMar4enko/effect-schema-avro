import { Array, Effect, Match, Schema, SchemaAST, flow, pipe } from 'effect'
import type { MatcherTypeId } from 'effect/Match'
import * as Option from 'effect/Option'
import type { Predicate, Refinement } from 'effect/Predicate'
import * as AST from 'effect/SchemaAST'
import type { Contravariant, Covariant } from 'effect/Types'

const GetStateSymbol: unique symbol = Symbol(`@compiler/GetState`)
type GetStateSymbol = typeof GetStateSymbol

const SetStateSymbol: unique symbol = Symbol(`@compiler/SetState`)
type SetStateSymbol = typeof SetStateSymbol

const CompileSymbol: unique symbol = Symbol(`@compiler/Compile`)
type CompileSymbol = typeof CompileSymbol

export class NotImplementedError extends Error {
  i: unknown
  constructor(i: unknown, message: string) {
    super(message)
    this.i = i
  }
}

export declare namespace Compiler {
  export interface GetState<State> {
    [GetStateSymbol]: State
  }

  export interface ModifyState<State> {
    [SetStateSymbol]: (state: State) => State
  }

  export interface Compile<I> {
    [CompileSymbol]: I
  }

  export interface Effects<I, A, State> {
    getState: Iterable<Step<I, State>, State>
    modifyState: (fn: (state: State) => State) => Iterable<Step<I, State>, State>
    compile: <B extends I | I[]>(i: B) => Iterable<Step<I, State>, B extends I[] ? A[] : A>
  }

  export type Step<I, State> = GetState<State> | ModifyState<State> | Compile<I>

  export type CompilerGenerator<I, A, State> = Generator<Step<I, State>, A, never>

  export type AppliedCompiler<I, A, State> = (input: I) => CompilerGenerator<I, A, State>
  export type Compiler<I, A, State, M = I> = (input: M, compile: Effects<I, A, State>) => CompilerGenerator<I, A, State>

  export type Match<I, A> = (input: I) => Option.Option<A>

  export type Matcher<I, A, State> = {
    readonly [MatcherTypeId]: {
      readonly _return: Covariant<Compiler<I, A, State>>
    }
  }
}

export const isCompile = <I, State>(step: Compiler.Step<I, State>): step is Compiler.Compile<I> => CompileSymbol in step

export const isModifyState = <I, State>(step: Compiler.Step<I, State>): step is Compiler.ModifyState<State> =>
  SetStateSymbol in step

export const isGetState = <I, State>(step: Compiler.Step<I, State>): step is Compiler.GetState<State> =>
  GetStateSymbol in step

export const make =
  <I, A, State>() =>
  (i: I): Compiler.Compiler<I, A, State> =>
  () => {
    throw new NotImplementedError(i, `No match found`)
  }

export const compileMatch: <State, I, M, A>(
  match: Compiler.Match<I, M>,
  fn: NoInfer<Compiler.Compiler<I, A, State, M>>,
) => (m: (i: I) => Compiler.Compiler<I, A, State>) => (i: I) => Compiler.Compiler<I, A, State> =
  (match, fn) => (prev) => (i) => {
    const res = match(i)
    if (res._tag === `Some`) {
      // biome-ignore lint/suspicious/noExplicitAny: <explanation>
      return fn as any
    }

    return prev(i)
  }

//  flow(
//   match,
//   Option.getOrElse(() => )
//  ) as any

export const compile = function* <I, A>(i: I) {
  return (yield { [CompileSymbol]: i }) as A
}

export const getState = function* <State>() {
  return (yield { [GetStateSymbol]: GetStateSymbol }) as State
}

export const modifyState = function* <State>(modify: (state: State) => State) {
  return (yield { [SetStateSymbol]: modify }) as State
}
//   {
//   return Object.freeze({
//     [Symbol.iterator]() {
//       return {
//         next(a: any) {
//           return {
//             done: false,
//             value: { [SetStateSymbol]: modify },
//           }
//         },
//       }
//     },
//   })
// }

export const run =
  <I, A, State>(input: I, initialState: State) =>
  (comp: (i: I) => Compiler.Compiler<I, A, State>) => {
    const effects = {
      getState,
      modifyState,
      compile,
    } as unknown as Compiler.Effects<I, A, State>

    const compiler = comp(input)(input, effects)
    let state = initialState

    const runCompiler: <I>(compiler: Compiler.CompilerGenerator<I, A, State>) => I = (compiler) => {
      let step = compiler.next()
      while (true) {
        console.log(`Here is next step`, step)

        if (step.done) {
          // biome-ignore lint/suspicious/noExplicitAny: <explanation>
          return step.value as any
        }

        switch (true) {
          case isGetState(step.value):
            console.log(`Here is getState`, step.value[GetStateSymbol])
            // biome-ignore lint/suspicious/noExplicitAny: <explanation>
            step = compiler.next(state as never)
            continue
          case isModifyState(step.value):
            console.log(`Here is modifyState`, step.value[SetStateSymbol])
            state = step.value[SetStateSymbol](state)
            // biome-ignore lint/suspicious/noExplicitAny: <explanation>
            step = compiler.next(state as never)
            continue
          case isCompile(step.value):
            console.log(`Here is compile`, step.value[CompileSymbol])
            if (Array.isArray(step.value[CompileSymbol])) {
              // biome-ignore lint/suspicious/noExplicitAny: <explanation>
              step = compiler.next(
                step.value[CompileSymbol].map((i: any) => {
                  return runCompiler(comp(i)(i, effects))
                }) as never,
              )
              continue
            }
            // biome-ignore lint/suspicious/noExplicitAny: <explanation>
            const i = step.value[CompileSymbol] as any
            step = compiler.next(runCompiler(comp(i)(i, effects)) as never)
            // return runCompiler(comp(i)(i, effects))
            continue
        }
      }
    }

    return runCompiler(compiler)
  }
