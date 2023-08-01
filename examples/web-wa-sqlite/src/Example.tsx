import React, { useEffect, useState } from 'react'
import './Example.css'

import { schema, Electric } from './generated/client'
import { electrify, ElectricDatabase } from 'electric-sql/wa-sqlite'
import { makeElectricContext, useLiveQuery } from 'electric-sql/react'
import { authToken } from 'electric-sql/auth'

const { ElectricProvider, useElectric } = makeElectricContext<Electric>()

export const Example = () => {
  const [ electric, setElectric ] = useState<Electric>()

  useEffect(() => {
    const init = async () => {
      const conn = await ElectricDatabase.init('electric.db', '')
      const db = await electrify(conn, schema, {
        auth: {
          token: await authToken('local-development', 'local-development-key-minimum-32-symbols')
        }
      })
      setElectric(db)
      // Calling `.sync()` methods is possible here, right after init:
      // await db.db.items.sync()
    }

    init()
  }, [])

  if (electric === undefined) {
    return null
  }

  return (
    <ElectricProvider db={electric}>
      <ExampleComponent />
    </ElectricProvider>
  )
}

const ExampleComponent = () => {
  const { db } = useElectric()!
  // Or here, in a `useEffect` without dependencies to limit it running once per component render.
  useEffect(() => void db.items.sync(), [])

  // `useliveQuery` will keep this variable up to data with the SQLite database, but to get data from server into SQLite
  // you need to call `.sync()`, as demonstrated on the line above
  const { results } = useLiveQuery(db.items.liveMany({})) // select all

  const addItem = async () => {
    await db.items.create({
      data: {
        value: crypto.randomUUID(),
        // uncomment the line below after migration
        //other_value: crypto.randomUUID(),
      }
    })
  }

  const clearItems = async () => {
    await db.items.deleteMany() // delete all items
  }

  // After the migration, comment out this code and uncomment code block below
  return (
    <div>
      <div className='controls'>
        <button className='button' onClick={addItem}>
          Add
        </button>
        <button className='button' onClick={clearItems}>
          Clear
        </button>
      </div>
      {results && results.map((item: any, index: any) => (
        <p key={ index } className='item'>
          <code>{ item.value }</code>
        </p>
      ))}
    </div>
  )

  // Uncomment after migration
  //return (
  //  <div>
  //    <div className='controls'>
  //      <button className='button' onClick={addItem}>
  //        Add
  //      </button>
  //      <button className='button' onClick={clearItems}>
  //        Clear
  //      </button>
  //    </div>
  //    {results && results.map((item: any, index: any) => (
  //      <p key={ index } className='item'>
  //        <code>{ item.value } - { item.other_value }</code>
  //      </p>
  //    ))}
  //  </div>
  //)
}
