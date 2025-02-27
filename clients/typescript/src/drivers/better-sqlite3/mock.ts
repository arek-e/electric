import { BindParams, DbName, Row, SqlValue } from '../../util/types'
import { Database, Statement, Transaction } from './database'
import type { Statement as OriginalStatement } from 'better-sqlite3'

type MockStatement<T extends BindParams = []> = Pick<
  Statement<T>,
  'source' | 'readonly' | 'database' | 'run' | 'get' | 'all' | 'iterate'
>

export class MockDatabase implements Database {
  name: DbName

  inTransaction = false
  memory = false

  constructor(name: DbName) {
    this.name = name
  }

  exec(_sql: string): this {
    return this
  }

  prepare<T extends unknown[] | {}, R>(_sql: string) {
    const mockStatement: MockStatement = {
      database: this as any,
      readonly: false,
      source: _sql,
      run: () => ({ changes: 0, lastInsertRowid: 1234 }),
      get: () => ({ foo: 'bar' }),
      all: (...params: SqlValue[] | [Row]) => {
        if (
          typeof params[0] == 'object' &&
          params[0] &&
          'shouldError' in params[0]
        ) {
          throw new Error('Mock query error')
        }

        return [{ foo: 'bar' }, { foo: 'baz' }]
      },
      iterate: () => [{ foo: 'bar' }, { foo: 'baz' }][Symbol.iterator](),
    }

    // Valid only for mocking since we don't expect to need to mock full interface
    return mockStatement as unknown as OriginalStatement<T, R>
  }

  transaction<T extends (...args: any[]) => any>(fn: T): Transaction<T> {
    const self = this

    const baseFn = (...args: unknown[]): ReturnType<T> => {
      self.inTransaction = true

      const retval = fn(...args)

      self.inTransaction = false

      return retval
    }

    const txFn = baseFn as unknown as Transaction<T>
    txFn.default = baseFn
    txFn.deferred = baseFn
    txFn.immediate = baseFn
    txFn.exclusive = baseFn

    return txFn
  }
}
