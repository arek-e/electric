import { Row } from '../../util/types'
import { AnyTableSchema } from '../model'
import { PgType } from './types'

export interface Converter {
  /**
   * Encodes the provided value for storing in the database.
   * @param v The value to encode.
   * @param pgType The Postgres type of the column in which to store the value.
   */
  encode(v: any, pgType: PgType): any
  /**
   * Encodes the provided row for storing in the database.
   * @param row The row to encode
   * @param tableSchema The schema of the table for this row.
   */
  encodeRow(row: Row, tableSchema: AnyTableSchema): Record<string, any>
  /**
   * Encodes the provided rows for storing in the database.
   * @param rows The rows to encode
   * @param tableSchema The schema of the table for these rows.
   */
  encodeRows(
    rows: Array<Row>,
    tableSchema: AnyTableSchema
  ): Array<Record<string, any>>
  /**
   * Decodes the provided value from the database.
   * @param v The value to decode.
   * @param pgType The Postgres type of the column from which to decode the value.
   */
  decode(v: any, pgType: PgType): any
  /**
   * Decodes the provided row from the database.
   * @param row The row to decode
   * @param tableSchema The schema of the table for this row.
   */
  decodeRow<T extends Record<string, any> = Record<string, any>>(
    row: Row,
    tableSchema: AnyTableSchema
  ): T
  /**
   * Decodes the provided rows from the database.
   * @param rows The rows to decode
   * @param tableSchema The schema of the table for these rows.
   */
  decodeRows<T extends Record<string, any> = Record<string, any>>(
    rows: Array<Row>,
    tableSchema: AnyTableSchema
  ): Array<T>
}

/**
 * Checks whether the provided value is a data object (e.g. a timestamp) and not a filter.
 * This is important because `input.ts` needs to distinguish between data objects and filter objects.
 * Data objects need to be converted to a SQLite storeable value, whereas filter objects need to be treated specially
 * as we have to transform the values of the filter's fields (cf. `transformFieldsAllowingFilters` in `input.ts`).
 * @param v The value to check
 * @returns True if it is a data object, false otherwise.
 */
export function isDataObject(v: unknown): boolean {
  return v instanceof Date || typeof v === 'bigint' || ArrayBuffer.isView(v)
}

export function mapRow<T extends Record<string, any> = Record<string, any>>(
  row: Row,
  tableSchema: AnyTableSchema,
  f: (v: any, pgType: PgType) => any
): T {
  const decodedRow = {} as T

  for (const [key, value] of Object.entries(row)) {
    const pgType = tableSchema.fields[key]
    const decodedValue = f(value, pgType)
    decodedRow[key as keyof T] = decodedValue
  }

  return decodedRow
}

export function mapRows<T extends Record<string, any> = Record<string, any>>(
  rows: Array<Row>,
  tableSchema: AnyTableSchema,
  f: (v: any, pgType: PgType) => any
): T[] {
  return rows.map((row) => mapRow<T>(row, tableSchema, f))
}
