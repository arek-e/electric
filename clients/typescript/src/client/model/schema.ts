import mapValues from 'lodash.mapvalues'
import partition from 'lodash.partition'
import groupBy from 'lodash.groupby'
import { Migration } from '../../migrators'
import { PgType } from '../conversions/types'

export type Arity = 'one' | 'many'

export type TableName = string
export type FieldName = string
export type RelationName = string

export type Fields = Record<FieldName, PgType>

export type TableSchema = {
  fields: Fields
  relations: Relation[]
}

export type ExtendedTableSchema = TableSchema & {
  outgoingRelations: Relation[]
  incomingRelations: Relation[]
}

export type TableSchemas = Record<TableName, TableSchema>

export type ExtendedTableSchemas = Record<TableName, ExtendedTableSchema>

export class Relation {
  constructor(
    public relationField: FieldName,
    public fromField: FieldName,
    public toField: FieldName,
    public relatedTable: TableName,
    public relationName: RelationName
  ) {}

  isIncomingRelation(): boolean {
    return this.fromField === '' && this.toField === ''
  }

  isOutgoingRelation(): boolean {
    return !this.isIncomingRelation()
  }

  getOppositeRelation(dbDescription: DbSchema<any>): Relation {
    return dbDescription.getRelation(this.relatedTable, this.relationName)
  }
}

export class DbSchema<T extends TableSchemas> {
  public readonly extendedTables: ExtendedTableSchemas

  // index mapping fields to an array of relations that map to that field
  private readonly incomingRelationsIndex: Record<
    TableName,
    Record<FieldName, Array<Relation>>
  >

  /**
   * @param tables Description of the database tables
   * @param migrations Bundled SQLite migrations
   * @param pgMigrations Bundled Postgres migrations
   */
  constructor(
    public tables: T,
    public migrations: Migration[],
    public pgMigrations: Migration[]
  ) {
    this.extendedTables = this.extend(tables)
    this.incomingRelationsIndex = this.indexIncomingRelations()
  }

  private extend(tbls: T): ExtendedTableSchemas {
    // map over object fields, then take the relations and then split them into 2 parts based on
    // isIncomingRelation and isOutgoingRelation
    return mapValues(tbls, (descr) => {
      const [incoming, outgoing] = partition(descr.relations, (r) =>
        r.isIncomingRelation()
      )
      return {
        ...descr,
        incomingRelations: incoming,
        outgoingRelations: outgoing,
      }
    })
  }

  private indexIncomingRelations(): Record<
    TableName,
    Record<FieldName, Array<Relation>>
  > {
    const tableNames = Object.keys(this.extendedTables)
    const buildRelationIndex = (tableName: TableName) => {
      // For each incoming relation we store the field that is pointed at by the relation
      // Several relations may point to the same field.
      // Therefore, we first group the incoming relations based on the field that they point to
      // Then we store those relations per field
      const inRelations = this.getIncomingRelations(tableName)
      return groupBy(inRelations, (relation) => {
        // group the relations by their `toField` property
        // but need to fetch that property on the outgoing side of the relation
        return relation.getOppositeRelation(this).toField
      })
    }

    const obj: Record<TableName, Record<FieldName, Array<Relation>>> = {}
    tableNames.forEach((tableName) => {
      obj[tableName] = buildRelationIndex(tableName)
    })

    return obj
  }

  hasTable(table: TableName): boolean {
    return Object.keys(this.extendedTables).includes(table)
  }

  getTableDescription(table: TableName): ExtendedTableSchema {
    return this.extendedTables[table]
  }

  getFields(table: TableName): Fields {
    return this.extendedTables[table].fields
  }

  getFieldNames(table: TableName): FieldName[] {
    return Array.from(Object.keys(this.getFields(table)))
  }

  hasRelationForField(table: TableName, field: FieldName): boolean {
    return this.getRelations(table).some((r) => r.relationField === field)
  }

  getRelationName(table: TableName, field: FieldName): RelationName {
    return this.getRelations(table).find((r) => r.relationField === field)!
      .relationName
  }

  getRelation(table: TableName, relation: RelationName): Relation {
    return this.getRelations(table).find((r) => r.relationName === relation)!
  }

  getRelatedTable(table: TableName, field: FieldName): TableName {
    const relationName = this.getRelationName(table, field)
    const relation = this.getRelation(table, relationName)
    return relation.relatedTable
  }

  getForeignKey(table: TableName, field: FieldName): FieldName {
    const relationName = this.getRelationName(table, field)
    const relation = this.getRelation(table, relationName)
    if (relation.isOutgoingRelation()) {
      return relation.fromField
    }
    // it's an incoming relation
    // we need to fetch the `fromField` from the outgoing relation
    const oppositeRelation = relation.getOppositeRelation(this)
    return oppositeRelation.fromField
  }

  // Profile.post <-> Post.profile (from: profileId, to: id)
  getRelations(table: TableName): Relation[] {
    return this.extendedTables[table].relations
  }

  getOutgoingRelations(table: TableName): Relation[] {
    return this.extendedTables[table].outgoingRelations
  }

  getIncomingRelations(table: TableName): Relation[] {
    return this.extendedTables[table].incomingRelations
  }

  getRelationsPointingAtField(table: TableName, field: FieldName): Relation[] {
    const index = this.incomingRelationsIndex[table]
    const relations = index[field]
    if (typeof relations === 'undefined') return []
    else return relations
  }
}
