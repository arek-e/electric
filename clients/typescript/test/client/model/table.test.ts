import { z } from 'zod'
import test from 'ava'
import Database, { SqliteError } from 'better-sqlite3'

import { MockRegistry } from '../../../src/satellite/mock'

import { electrify } from '../../../src/drivers/better-sqlite3'
import { InvalidArgumentError } from '../../../src/client/validation/errors/invalidArgumentError'
import { UpdateManyInput } from '../../../src/client/input/updateInput'
import {
  _NOT_UNIQUE_,
  _RECORD_NOT_FOUND_,
} from '../../../src/client/validation/errors/messages'
import { schema, Post } from '../generated'
import { makeContext } from '../../satellite/common'
import { globalRegistry } from '../../../src/satellite'
import { ElectricClient } from '../../../src/client/model'
import { InvalidRecordTransformationError } from '../../../src/client/validation/errors/invalidRecordTransformationError'

const db = new Database(':memory:')
const electric = await electrify(
  db,
  schema,
  {},
  { registry: new MockRegistry() }
)

// TODO: write test with nested includes (e.g. introduce a category table and every post has 1 category)
//       then check that we can find users and include their authored posts and include the category of those posts
//       do this when we have automated the generation such that we don't need to manually define all those tables
//       schemas, etc.

const electricDb = electric.db
const tbl = electric.db.Post
const postTable = tbl
const userTable = electric.db.User
const profileTable = electric.db.Profile
const imageTable = electric.db.ProfileImage

// Sync all shapes such that we don't get warnings on every query
await Promise.all([
  postTable.sync(),
  userTable.sync(),
  profileTable.sync(),
  imageTable.sync(),
])

const post1 = {
  id: 1,
  title: 't1',
  contents: 'c1',
  nbr: 18,
  authorId: 1,
}

const commonNbr = 21

const post2 = {
  id: 2,
  title: 't2',
  contents: 'c2',
  nbr: commonNbr,
  authorId: 1,
}

const post3 = {
  id: 3,
  title: 't2',
  contents: 'c3',
  nbr: commonNbr,
  authorId: 2,
}

const author1 = {
  id: 1,
  name: 'alice',
  meta: null,
}

const profile1 = {
  id: 1,
  bio: 'bio 1',
  meta: null,
  userId: 1,
  imageId: null,
}

const author2 = {
  id: 2,
  name: 'bob',
  meta: 'information',
}

const image1 = {
  id: 'image-1',
  image: new Uint8Array([1, 2, 3]),
}

const profile2 = {
  id: 2,
  bio: 'bio 2',
  meta: { foo: 3 },
  userId: 2,
  imageId: image1.id,
}

// An invalid JSON that will throw if `JSON.parse()` is called
// on it - the valid string literal would be "'invalid json"'
const invalidJson = 'invalid json'

const sortById = <T extends { id: number }>(arr: Array<T>) =>
  arr.sort((a, b) => b.id - a.id)

// Create a Post table in the DB first
function clear() {
  db.exec('DROP TABLE IF EXISTS Post')
  db.exec(
    "CREATE TABLE IF NOT EXISTS Post('id' int PRIMARY KEY, 'title' varchar, 'contents' varchar, 'nbr' int, 'authorId' int);"
  )
  db.exec('DROP TABLE IF EXISTS User')
  db.exec(
    "CREATE TABLE IF NOT EXISTS User('id' int PRIMARY KEY, 'name' varchar, 'meta' varchar);"
  )
  db.exec('DROP TABLE IF EXISTS Profile')
  db.exec(
    "CREATE TABLE IF NOT EXISTS Profile('id' int PRIMARY KEY, 'bio' varchar, 'meta' json, 'userId' int, 'imageId' varchar);"
  )
  db.exec('DROP TABLE IF EXISTS ProfileImage')
  db.exec(
    "CREATE TABLE IF NOT EXISTS ProfileImage('id' varchar PRIMARY KEY, 'image' blob);"
  )
}

clear()

test.serial('create query inserts NULL for undefined values', async (t) => {
  const obj = {
    data: {
      id: 1,
      title: 't1',
      contents: 'c1',
      nbr: undefined,
      authorId: 1,
    },
  }
  const res = await tbl.create(obj)

  t.deepEqual(res, {
    id: 1,
    title: 't1',
    contents: 'c1',
    nbr: null,
    authorId: 1,
  })

  clear()
})

test.serial('create query handles null values correctly', async (t) => {
  const res = await tbl.create({
    data: {
      id: 1,
      title: 't1',
      contents: 'c1',
      nbr: null,
      authorId: 1,
    },
  })

  t.deepEqual(res, {
    id: 1,
    title: 't1',
    contents: 'c1',
    nbr: null,
    authorId: 1,
  })

  clear()
})

test.serial(
  'create query inserts NULL values for missing fields',
  async (t) => {
    const res = await tbl.create({
      data: {
        id: 1,
        title: 't1',
        contents: 'c1',
        authorId: 1,
      },
    })

    t.deepEqual(res, {
      id: 1,
      title: 't1',
      contents: 'c1',
      nbr: null,
      authorId: 1,
    })

    clear()
  }
)

test.serial('create query with nested object for outgoing FK', async (t) => {
  const res = await tbl.create({
    data: {
      id: 5,
      title: 'foo',
      contents: 'bar',
      author: {
        create: {
          id: 1094,
          name: 'kevin',
        },
      },
      //authorId: 1
    },
  })

  t.deepEqual(res, {
    id: 5,
    title: 'foo',
    contents: 'bar',
    nbr: null,
    authorId: 1094,
  })

  const relatedUser = await userTable.findUnique({
    where: {
      id: 1094,
    },
  })

  t.deepEqual(relatedUser, {
    id: 1094,
    name: 'kevin',
    meta: null,
  })

  clear()
})

test.serial('create query with nested objects for incoming FK', async (t) => {
  const res = await userTable.create({
    data: {
      id: 1094,
      name: 'kevin',
      posts: {
        create: [
          {
            id: 5,
            title: 'foo',
            contents: 'bar',
          },
          {
            id: 6,
            title: 'test',
            contents: 'nested post',
          },
        ],
      },
    },
  })

  t.deepEqual(res, {
    id: 1094,
    name: 'kevin',
    meta: null,
  })

  const relatedPost1 = await postTable.findUnique({
    where: {
      id: 5,
    },
  })

  const relatedPost2 = await postTable.findUnique({
    where: {
      id: 6,
    },
  })

  t.deepEqual(relatedPost1, {
    id: 5,
    title: 'foo',
    contents: 'bar',
    nbr: null,
    authorId: 1094,
  })

  t.deepEqual(relatedPost2, {
    id: 6,
    title: 'test',
    contents: 'nested post',
    nbr: null,
    authorId: 1094,
  })

  clear()
})

test.serial('create query with nullable FK', async (t) => {
  const res = await profileTable.create({
    data: {
      id: 1094,
      bio: 'whatever',
      userId: 1,
      imageId: null,
    },
    include: { image: true },
  })

  t.deepEqual(res, {
    id: 1094,
    bio: 'whatever',
    meta: null,
    imageId: null,
    userId: 1,
  })

  clear()
})

// Test that we can make a create query
test.serial('create query', async (t) => {
  const res = await tbl.create({
    data: post1,
  })

  t.deepEqual(res, post1)

  clear()
})

test.serial(
  'create query supports nested objects with same column names different types',
  async (t) => {
    const res = await profileTable.create({
      data: {
        id: 4012,
        bio: 'test',
        meta: { bar: 'test' },
        user: {
          create: {
            id: 4013,
            name: 'kevin',
            meta: invalidJson,
          },
        },
      },
      include: {
        user: true,
      },
    })

    t.deepEqual(res, {
      id: 4012,
      bio: 'test',
      meta: { bar: 'test' },
      userId: 4013,
      user: {
        id: 4013,
        name: 'kevin',
        meta: invalidJson,
      },
      imageId: null,
    })

    clear()
  }
)

test.serial('create query supports include argument', async (t) => {
  await userTable.createMany({
    data: [author1, author2],
  })

  const res = await tbl.create({
    data: post1,
    include: {
      author: true,
    },
  })

  t.deepEqual(res, {
    ...post1,
    author: author1,
  })
})

test.serial(
  'create query throws an error if primary key already exists',
  async (t) => {
    const record = {
      id: post1.id,
      title: 'some title',
      contents: 'some contents',
      nbr: 18,
      authorId: 1,
    }

    await t.throwsAsync(
      async () => {
        await tbl.create({
          data: record,
        })
      },
      {
        instanceOf: SqliteError,
        message: 'UNIQUE constraint failed: Post.id',
      }
    )
  }
)

test.serial('createMany query', async (t) => {
  const res = await tbl.createMany({
    data: [post2, post3],
  })

  t.deepEqual(res, { count: 2 })

  // Check that skipDuplicates argument works
  const res2 = await tbl.createMany({
    data: [post2, post3],
    skipDuplicates: true,
  })

  t.deepEqual(res2, { count: 0 })
})

test.serial('findUnique query', async (t) => {
  const res = await tbl.findUnique({
    where: {
      id: post2.id,
      //nbr: post2.nbr,
    },
  })

  t.deepEqual(res, post2)
})

test.serial('raw query', async (t) => {
  const res = await electricDb.rawQuery({
    sql: 'SELECT * FROM Post WHERE id = ?',
    args: [post2.id],
  })
  t.assert(res.length === 1)
  t.deepEqual(res[0], post2)
})

test.serial('findUnique query with selection', async (t) => {
  const res = await tbl.findUnique({
    where: {
      id: post2.id,
    },
    select: {
      title: true,
      contents: false,
    },
  })

  t.deepEqual(res, {
    id: post2.id, // fields provided in `where` argument are always returned even if they are not selected
    title: post2.title,
  })
})

test.serial('findUnique query with include', async (t) => {
  const res = await tbl.findUnique({
    where: {
      id: post2.id,
    },
    include: {
      author: true,
    },
  })

  t.deepEqual(res, {
    ...post2,
    author: author1,
  })
})

test.serial(
  'findUnique query with empty `where` arguments should throw an error',
  async (t) => {
    await t.throwsAsync<InvalidArgumentError>(async () => {
      await tbl.findUnique({
        where: {},
      })
    })
  }
)

test.serial(
  'findUnique query with empty selection should throw an error',
  async (t) => {
    await t.throwsAsync<InvalidArgumentError>(async () => {
      await tbl.findUnique({
        where: {
          id: 2,
          //nbr: 21,
        },
        select: {
          contents: false,
        },
      })
    })
  }
)

test.serial('findFirst query returns first result', async (t) => {
  const res = await tbl.findFirst({
    where: {
      nbr: commonNbr,
    },
  })

  t.deepEqual(res, post2)
})

test.serial(
  'FindFirst query with descending order returns last result',
  async (t) => {
    const allRecords = await tbl.findMany({
      where: {
        nbr: commonNbr,
      },
      orderBy: {
        id: 'asc',
      },
    })

    t.assert(allRecords.length > 1)

    const lastRecord = allRecords[allRecords.length - 1]
    const foundRecord = await tbl.findFirst({
      where: {
        nbr: commonNbr,
      },
      orderBy: {
        id: 'desc',
      },
    })

    t.deepEqual(foundRecord, lastRecord)
  }
)

test.serial('FindFirst query supports skip', async (t) => {
  const skip = 1
  const allRecords = await tbl.findMany({
    orderBy: {
      id: 'asc',
    },
  })

  t.assert(allRecords.length > 1)

  const matchingRecord = allRecords[skip]
  const foundRecord = await tbl.findFirst({
    orderBy: {
      id: 'asc',
    },
    skip,
  })

  t.deepEqual(foundRecord, matchingRecord)
})

test.serial('findFirst query argument is optional', async (t) => {
  const res = await tbl.findFirst()
  t.deepEqual(res, post1)
})

test.serial('findFirst query supports include', async (t) => {
  const res = await tbl.findFirst({
    where: {
      nbr: commonNbr,
    },
    include: {
      author: true,
    },
  })

  t.deepEqual(res, {
    ...post2,
    author: author1,
  })
})

test.serial(
  'selection should throw an error if object is invalid',
  async (t) => {
    await t.throwsAsync<InvalidArgumentError>(async () => {
      await tbl.findMany({
        select: {
          contents: true,
          foo: false, // field `foo` does not exist, should throw an error
        } as any, // mislead the type checker to check that it throws a runtime error
      })
    })
  }
)

test.serial(
  'findMany can fetch related objects based on outgoing FK of one-to-many relation',
  async (t) => {
    const res = await tbl.findMany({
      where: {
        id: {
          in: [1, 3], // fetch post 1 and 3
        },
      },
      include: {
        author: true,
      },
    })

    t.deepEqual(
      sortById(res),
      sortById([
        {
          id: 1,
          title: 't1',
          contents: 'c1',
          nbr: 18,
          authorId: 1,
          author: author1,
        },
        {
          id: 3,
          title: 't2',
          contents: 'c3',
          nbr: commonNbr,
          authorId: 2,
          author: author2,
        },
      ])
    )

    const res2 = await tbl.findMany({
      where: {
        id: {
          in: [1, 3], // fetch post 1 and 3
        },
      },
      include: {
        author: {
          select: {
            id: true,
          },
        },
      },
    })

    t.deepEqual(
      sortById(res2),
      sortById([
        {
          id: 1,
          title: 't1',
          contents: 'c1',
          nbr: 18,
          authorId: 1,
          author: {
            id: author1.id,
          },
        },
        {
          id: 3,
          title: 't2',
          contents: 'c3',
          nbr: commonNbr,
          authorId: 2,
          author: {
            id: author2.id,
          },
        },
      ])
    )
  }
)

test.serial(
  'findMany can fetch related objects based on incoming FK of one-to-many relation',
  async (t) => {
    const res = await userTable.findMany({
      include: {
        posts: true,
        profile: true,
      },
    })

    t.deepEqual(res, [
      {
        ...author1,
        posts: [post1, post2],
      },
      {
        ...author2,
        posts: [post3],
      },
    ])
  }
)

/*
// Not supported yet:
test.serial('findMany can fetch records based on fields of related records', async (t) => {
  const postsByAlice = await tbl.findMany({
    where: {
      author: {
        is: {
          name: 'alice'
        }
      }
    }
  })

  t.deepEqual(postsByAlice, [post1, post2])
})
*/

test.serial('findMany allows results to be ordered', async (t) => {
  const res = await tbl.findMany({
    orderBy: [
      {
        title: 'asc',
      },
      {
        contents: 'desc',
      },
    ],
  })

  t.deepEqual(res, [post1, post3, post2])
})

test.serial('findMany supports `not` and `in` filters', async (t) => {
  const res = await tbl.findMany({
    where: {
      id: { not: 3, in: [1, 2, 3] },
    },
    orderBy: [
      {
        title: 'asc',
      },
      {
        contents: 'desc',
      },
    ],
  })

  t.deepEqual(res, [post1, post2])
})

test.serial('update query', async (t) => {
  // Regular update
  const res = await tbl.update({
    data: { title: 'Foo', contents: 'Bar' },
    where: { id: post1.id },
    select: { title: true, contents: true },
  })

  t.deepEqual(res, {
    title: 'Foo',
    contents: 'Bar',
  })

  // Put the title and contents back to their original value
  await tbl.update({
    data: { title: post1.title, contents: post1.contents },
    where: { id: post1.id },
  })

  // Update the primary key
  const res2 = await tbl.update({
    data: { id: 5 },
    where: { id: post1.id },
  })

  t.deepEqual(res2, {
    ...post1,
    id: 5,
  })

  // Update primary key and return only a selection
  const res3 = await tbl.update({
    data: { id: post1.id },
    where: { id: 5 },
    select: { title: true },
  })

  t.deepEqual(res3, { title: post1.title })

  // Also include the author
  const res4 = await tbl.update({
    data: { id: post1.id }, // doesn't actually change it, but doesn't matter for this test
    where: { id: post1.id },
    include: { author: true },
  })

  t.deepEqual(res4, {
    ...post1,
    author: author1,
  })
})

test.serial(
  'update query throws an error if where argument is invalid',
  async (t) => {
    await t.throwsAsync<z.ZodError>(async () => {
      await tbl.update({
        data: { title: 'Foo', contents: 'Bar' },
      } as any) // mislead the type checker to see that it is caught at runtime
    })

    await t.throwsAsync<InvalidArgumentError>(async () => {
      await tbl.update({
        data: { title: 'Foo', contents: 'Bar' },
        where: {}, // cannot be empty, must at least define one field
      })
    })

    await t.throwsAsync<z.ZodError>(async () => {
      await tbl.update({
        data: { title: 'Foo', contents: 'Bar' },
        where: { foo: 1 }, // `foo` is not a field of `Post`
      } as any) // mislead the type checker to see that it is caught at runtime
    })
  }
)

test.serial(
  'update query throws an error if more than one record matches',
  async (t) => {
    await t.throwsAsync<InvalidArgumentError>(
      async () => {
        await tbl.update({
          data: { title: 'Foo', contents: 'Bar' },
          where: { title: 't2' }, // there are two posts with this title
        })
      },
      {
        instanceOf: InvalidArgumentError,
        message: _NOT_UNIQUE_,
      }
    )
  }
)

test.serial('update query throws an error if no record matches', async (t) => {
  await t.throwsAsync<InvalidArgumentError>(
    async () => {
      await tbl.update({
        data: { title: 'Foo', contents: 'Bar' },
        where: { id: -3 },
      })
    },
    {
      instanceOf: InvalidArgumentError,
      message: _RECORD_NOT_FOUND_('Update'),
    }
  )
})

test.serial('updateMany query', async (t) => {
  const res = await tbl.updateMany({
    data: { title: 'Foo', contents: 'Bar' },
  })

  t.deepEqual(res, { count: 3 })

  // Check that all posts were changed
  const allPosts = await tbl.findMany({})
  allPosts.forEach((post) => {
    t.is(post.title, 'Foo')
    t.is(post.contents, 'Bar')
  })

  const res2 = await tbl.updateMany({
    data: { contents: 'Baz' },
    where: {}, // empty where clause should simply be ignored
  })

  t.deepEqual(res2, { count: 3 })

  // Check that all posts were changed
  const allPosts2 = await tbl.findMany({})
  allPosts2.forEach((post) => {
    t.is(post.contents, 'Baz')
  })

  const allPosts3 = await tbl.findMany({})

  // Update all posts that fulfill a certain condition
  const res3 = await tbl.updateMany({
    data: { title: 'Changed' },
    where: {
      nbr: commonNbr,
    },
  })

  t.deepEqual(res3, { count: 2 })

  // Check that only those posts were changed
  const allPosts4 = await tbl.findMany({})
  t.deepEqual(
    new Set(allPosts4),
    new Set(
      allPosts3.map((post) => {
        if (post.nbr === commonNbr) return { ...post, title: 'Changed' }
        else return post
      })
    )
  )

  await t.throwsAsync<z.ZodError>(async () => {
    await tbl.updateMany({
      data: { title: 'Foo', contents: 'Bar' },
      where: { foo: 1 }, // `foo` is not a field of `Post`
    } as unknown as UpdateManyInput<any, any>) // mislead the type checker to see that it is caught at runtime
  })
})

test.serial('upsert query', async (t) => {
  const newPost = {
    id: 4,
    title: 't4',
    contents: 'c4',
    nbr: 5,
    authorId: 1,
  }
  const updatePost = { title: 'Modified title' }

  // There is no post with identifier `i4` so it will be created
  const res1 = await tbl.upsert({
    create: newPost,
    update: updatePost,
    where: {
      id: newPost.id,
    },
  })

  t.deepEqual(res1, newPost)

  // Now, identifier `i4` exists, so it will update
  const res2 = await tbl.upsert({
    create: newPost,
    update: updatePost,
    where: {
      id: newPost.id,
    },
    select: {
      id: true,
      title: true,
      contents: true,
    },
  })

  t.deepEqual(res2, {
    id: newPost.id,
    title: updatePost.title,
    contents: newPost.contents,
  })
})

test.serial('upsert supports include argument', async (t) => {
  const newPost = {
    id: 356,
    title: 't4',
    contents: 'c4',
    nbr: 5,
    authorId: 1,
  }
  const updatePost = { title: 'Modified title' }

  // There is no post with identifier `i4` so it will be created
  const res1 = await tbl.upsert({
    create: newPost,
    update: updatePost,
    where: {
      id: newPost.id,
    },
    include: {
      author: true,
    },
  })

  t.deepEqual(res1, {
    ...newPost,
    author: author1,
  })

  // Now, identifier `i4` exists, so it will update
  const res2 = await tbl.upsert({
    create: newPost,
    update: updatePost,
    where: {
      id: newPost.id,
    },
    include: {
      author: true,
    },
  })

  t.deepEqual(res2, {
    ...newPost,
    title: updatePost.title,
    author: author1,
  })
})

test.serial(
  'upsert query throws an error if record is not unique',
  async (t) => {
    await t.throwsAsync(
      async () => {
        await tbl.upsert({
          create: post1,
          update: {},
          where: {
            title: 'Changed', // not unique
          },
        })
      },
      {
        instanceOf: InvalidArgumentError,
        message: _NOT_UNIQUE_,
      }
    )
  }
)

test.serial('delete query', async (t) => {
  const p1 = await tbl.findUnique({
    where: { id: post1.id },
  })

  const res = await tbl.delete({
    where: { id: post1.id },
    select: { nbr: true },
  })

  t.deepEqual(res, { nbr: 18 })

  // Insert p1 again in the DB
  await tbl.create({ data: p1 as unknown as Post })
})

test.serial('delete query supports include argument', async (t) => {
  const p1 = await tbl.findUnique({
    where: { id: post1.id },
  })

  const res = await tbl.delete({
    where: { id: post1.id },
    include: { author: true },
  })

  t.deepEqual(res, {
    ...p1,
    author: author1,
  })

  // Insert p1 again in the DB
  await tbl.create({ data: p1 as unknown as Post })
})

test.serial('delete query throws error if input is invalid', async (t) => {
  await t.throwsAsync<InvalidArgumentError>(async () => {
    await tbl.delete({
      where: {},
    })
  })

  await t.throwsAsync<z.ZodError>(async () => {
    await tbl.delete({} as any) // mislead the type checker to see that it is caught at runtime
  })
})

test.serial('delete query throws error if record does not exist', async (t) => {
  await t.throwsAsync(
    async () => {
      await tbl.delete({
        where: {
          id: -1,
        },
      })
    },
    {
      instanceOf: InvalidArgumentError,
      message: _RECORD_NOT_FOUND_('Delete'),
    }
  )
})

test.serial(
  'delete query throws error if it matches more than one record',
  async (t) => {
    await t.throwsAsync(
      async () => {
        await tbl.delete({
          where: {
            title: 'Changed',
          },
        })
      },
      {
        instanceOf: InvalidArgumentError,
        message: _NOT_UNIQUE_,
      }
    )
  }
)

test.serial('deleteMany query', async (t) => {
  const [p1, ...rest] = await tbl.findMany({})

  const res = await tbl.deleteMany({
    where: { id: p1.id, title: p1.title },
  })

  t.deepEqual(res, { count: 1 })

  // Check that p1 is deleted and only p2 and p3 remain
  const remainingPosts = await tbl.findMany({})
  t.deepEqual(new Set(rest), new Set(remainingPosts))

  // Test deleting everything
  const res2 = await tbl.deleteMany({})
  t.deepEqual(res2, { count: 4 })

  const emptyPosts = await tbl.findMany({})
  t.is(emptyPosts.length, 0)
})

async function populate() {
  clear()

  await postTable.createMany({
    data: [post1, post2, post3],
  })

  await userTable.createMany({
    data: [author1, author2],
  })

  await profileTable.createMany({
    data: [profile1, profile2],
  })

  await imageTable.createMany({
    data: [image1],
  })
}

test.serial(
  'findMany can handle related objects with fields of same name and different type',
  async (t) => {
    await populate()
    const res = await profileTable.findMany({
      where: { id: profile2.id },
      include: { user: true },
    })

    t.deepEqual(res, [
      {
        ...profile2,
        user: author2,
      },
    ])
  }
)

test.serial('findMany can handle nullable foreign keys', async (t) => {
  await populate()
  const res = await profileTable.findMany({
    include: { image: true },
  })

  t.deepEqual(res, [profile1, { ...profile2, image: image1 }])
})

test.serial(
  'update query can handle related objects with fields of same name and different type',
  async (t) => {
    await populate()
    const res = await profileTable.update({
      where: { id: 2 },
      data: {
        meta: { bar: 3 },
        user: {
          update: {
            meta: invalidJson,
          },
        },
      },
      include: {
        user: true,
      },
    })

    t.deepEqual(res, {
      ...profile2,
      meta: { bar: 3 },
      user: {
        ...author2,
        meta: invalidJson,
      },
    })
  }
)

test.serial(
  'update query can update related object for outgoing FK',
  async (t) => {
    await populate()

    // post 1 & 2 -> author 1
    // post 3 -> author 2

    const fetchPost1 = async () => {
      return await postTable.findUnique({
        where: {
          id: post1.id,
        },
        include: {
          author: true,
        },
      })
    }

    const r = await fetchPost1()
    t.deepEqual(r, {
      ...post1,
      author: author1,
    })

    const res = await postTable.update({
      data: {
        title: 'Updated title',
        author: {
          update: {
            name: 'Updated name',
          },
        },
      },
      where: {
        id: post1.id,
      },
      include: {
        author: true,
      },
    })

    const expectedRes = {
      ...post1,
      title: 'Updated title',
      author: {
        ...author1,
        name: 'Updated name',
      },
    }

    t.deepEqual(res, expectedRes)

    t.deepEqual(await fetchPost1(), expectedRes)
  }
)

test.serial(
  'update query updates foreign key on update of related object',
  async (t) => {
    await populate()

    // post 1 & 2 -> author 1
    // post 3 -> author 2

    const fetchPost1 = async () => {
      return await postTable.findUnique({
        where: {
          id: post1.id,
        },
        include: {
          author: true,
        },
      })
    }

    const r = await fetchPost1()
    t.deepEqual(r, {
      ...post1,
      author: author1,
    })

    const res = await postTable.update({
      data: {
        title: 'Updated title',
        author: {
          update: {
            // we update the id of the user
            // which is pointed at by the related posts
            // after the update, those posts must still link to this user
            id: 5,
            name: 'Updated name',
          },
        },
      },
      where: {
        id: post1.id,
      },
      include: {
        author: true,
      },
    })

    const expectedRes = {
      ...post1,
      title: 'Updated title',
      // update must also have modified the `authorId` field
      // such that it still points to the related object
      authorId: 5,
      author: {
        ...author1,
        id: 5,
        name: 'Updated name',
      },
    }

    t.deepEqual(res, expectedRes)

    t.deepEqual(await fetchPost1(), expectedRes)
  }
)

test.serial(
  'update query can update related object for incoming one-to-many FK',
  async (t) => {
    await populate()

    // post 1 & 2 -> author 1
    // post 3 -> author 2

    const fetchAuthor1 = async () => {
      return await userTable.findUnique({
        where: {
          id: author1.id,
        },
        include: {
          posts: true,
        },
      })
    }

    const r = await fetchAuthor1()
    t.deepEqual(r, {
      ...author1,
      posts: [post1, post2],
    })

    const res = await userTable.update({
      // Update the name of user 1 as well as the title of his post with id 2
      data: {
        name: 'Updated name',
        posts: {
          update: {
            data: {
              title: 'Updated title',
            },
            where: {
              id: post2.id,
            },
          },
        },
      },
      where: {
        id: author1.id,
      },
      include: {
        posts: true,
      },
    })

    const expectedRes = {
      ...author1,
      name: 'Updated name',
      posts: [
        post1,
        {
          ...post2,
          title: 'Updated title',
        },
      ],
    }

    t.deepEqual(res, expectedRes)

    t.deepEqual(await fetchAuthor1(), expectedRes)
  }
)

test.serial(
  'update query can update related object for incoming one-to-one FK',
  async (t) => {
    await populate()

    // post 1 & 2 -> author 1
    // post 3 -> author 2

    const fetchUser1 = async () => {
      return await userTable.findUnique({
        where: {
          id: author1.id,
        },
        include: {
          profile: true,
        },
      })
    }

    const r = await fetchUser1()
    t.deepEqual(r, {
      ...author1,
      profile: profile1,
    })

    const res = await userTable.update({
      // Update the name of user 1 as well as the bio in his profile
      data: {
        name: 'Updated name',
        profile: {
          update: {
            bio: 'Updated bio',
          },
        },
      },
      where: {
        id: author1.id,
      },
      include: {
        profile: true,
      },
    })

    const expectedRes = {
      ...author1,
      name: 'Updated name',
      profile: {
        ...profile1,
        bio: 'Updated bio',
      },
    }

    t.deepEqual(res, expectedRes)

    t.deepEqual(await fetchUser1(), expectedRes)

    // Check that the other users' profiles are not changed
    const profile2Res = await profileTable.findUnique({
      where: {
        id: profile2.id,
      },
    })

    t.deepEqual(profile2Res, profile2)
  }
)

test.serial(
  'update query updates foreign keys of related objects',
  async (t) => {
    await populate()

    // post 1 & 2 -> author 1
    // post 3 -> author 2

    const updatedUser = {
      // We update the id of the user which is pointed at by the posts they wrote.
      // After the update, those posts must still link to this user.
      id: 5,
      name: 'Updated name',
    }

    // User 1 authored 2 posts: post 1 & 2
    // We will update the id of user 1 and check that posts 1 & 2 now point to the user's new id
    const user = await userTable.update({
      data: updatedUser,
      where: {
        id: 1,
      },
    })

    t.deepEqual(user, {
      ...author1,
      ...updatedUser,
    })

    const posts = await postTable.findMany({
      where: {
        id: {
          in: [1, 2],
        },
      },
    })

    t.is(posts.length, 2)
    posts.forEach((p) => t.is(p.authorId, updatedUser.id))
  }
)

test.serial(
  'update query throws error if nested object for incoming one-to-many relation is not related',
  async (t) => {
    await populate()

    // post 1 & 2 -> author 1
    // post 3 -> author 2

    // User 1 authored 2 posts: post 1 & 2
    // We will update the id of user 1 and check that posts 1 & 2 now point to the user's new id
    await t.throwsAsync(async () => {
      return await userTable.update({
        data: {
          name: 'Updated name',
          posts: {
            update: {
              data: {
                title: 'Updated title',
              },
              where: {
                id: post3.id, // Post 3 is not written by user 1, and hence, is not a related object
              },
            },
          },
        },
        where: {
          id: 1,
        },
      })
    })

    const fetchedPost3 = await postTable.findUnique({
      where: {
        id: post3.id,
      },
    })

    t.deepEqual(fetchedPost3, post3)
  }
)

test.serial(
  'update query can updateMany related objects for incoming one-to-many FK',
  async (t) => {
    await populate()

    // post 1 & 2 -> author 1
    // post 3 -> author 2

    const fetchAuthor1 = async () => {
      return await userTable.findUnique({
        where: {
          id: author1.id,
        },
        include: {
          posts: true,
        },
      })
    }

    const r = await fetchAuthor1()
    t.deepEqual(r, {
      ...author1,
      posts: [post1, post2],
    })

    const res = await userTable.update({
      // Update the name of user 1 as well as the title of his posts using a nested updateMany query
      data: {
        name: 'Updated name',
        posts: {
          updateMany: {
            data: {
              title: 'Updated title',
            },
            where: {},
          },
        },
      },
      where: {
        id: author1.id,
      },
      include: {
        posts: true,
      },
    })

    const expectedRes = {
      ...author1,
      name: 'Updated name',
      posts: [
        {
          ...post1,
          title: 'Updated title',
        },
        {
          ...post2,
          title: 'Updated title',
        },
      ],
    }

    t.deepEqual(res, expectedRes)
    t.deepEqual(await fetchAuthor1(), expectedRes)

    // Check that it did not affect the third post
    // Because only post 1 and post 2 are related to author 1
    const post3Res = await postTable.findUnique({
      where: {
        id: 3,
      },
    })

    t.deepEqual(post3Res, post3)
  }
)

test.serial(
  'update query supports array of nested updateMany queries for incoming one-to-many FK',
  async (t) => {
    await populate()

    // post 1 & 2 -> author 1
    // post 3 -> author 2

    const fetchAuthor1 = async () => {
      return await userTable.findUnique({
        where: {
          id: author1.id,
        },
        include: {
          posts: true,
        },
      })
    }

    const r = await fetchAuthor1()
    t.deepEqual(r, {
      ...author1,
      posts: [post1, post2],
    })

    const res = await userTable.update({
      // Update the name of user 1 as well as the title of his posts using separate updateMany queries
      data: {
        name: 'Updated name',
        posts: {
          updateMany: [
            {
              data: {
                title: 'Updated title for post 1',
              },
              where: {
                id: post1.id,
              },
            },
            {
              data: {
                title: 'Updated title for post 2',
              },
              where: {
                id: post2.id,
              },
            },
          ],
        },
      },
      where: {
        id: author1.id,
      },
      include: {
        posts: true,
      },
    })

    const expectedRes = {
      ...author1,
      name: 'Updated name',
      posts: [
        {
          ...post1,
          title: 'Updated title for post 1',
        },
        {
          ...post2,
          title: 'Updated title for post 2',
        },
      ],
    }

    t.deepEqual(res, expectedRes)
    t.deepEqual(await fetchAuthor1(), expectedRes)

    // Check that it did not affect the third post
    // Because only post 1 and post 2 are related to author 1
    const post3Res = await postTable.findUnique({
      where: {
        id: 3,
      },
    })

    t.deepEqual(post3Res, post3)
  }
)

for (const fn of ['liveMany', 'liveFirst'] as const) {
  test.serial(
    `\`${fn}\` mentions all included tables in tablenames to watch`,
    async (t) => {
      await populate()

      const res = await userTable[fn]({ include: { posts: true } })()

      t.is(res.tablenames.length, 2)
      t.is(res.tablenames[0].tablename, 'User')
      t.is(res.tablenames[1].tablename, 'Post')
    }
  )
}

test.serial(
  '`liveUnique` mentions all included tables in tablenames to watch',
  async (t) => {
    await populate()

    const res = await userTable.liveUnique({
      include: { posts: true },
      where: { id: 1 },
    })()

    t.is(res.tablenames.length, 2)
    t.is(res.tablenames[0].tablename, 'User')
    t.is(res.tablenames[1].tablename, 'Post')
  }
)

test('setReplicationTransform should validate transform does not modify outgoing FK column', async (t: any) => {
  await makeContext(t, 'main')

  const { adapter, notifier, satellite, client } = t.context

  const electric = await ElectricClient.create(
    'testDB',
    schema,
    adapter,
    notifier,
    satellite,
    globalRegistry,
    'SQLite'
  )

  const postTable = electric.db.Post

  const modifyAuthorId = (post: any) => ({
    ...post,
    authorId: 9, // this is a FK, should not be allowed to modify it
  })

  // postTable, userTable
  postTable.setReplicationTransform({
    transformInbound: modifyAuthorId,
    transformOutbound: modifyAuthorId,
  })

  // Check outbound transform
  t.throws(
    () => client.replicationTransforms.get('Post').transformOutbound(post1),
    {
      instanceOf: InvalidRecordTransformationError,
      message: 'Record transformation modified immutable fields: authorId',
    }
  )

  // Also check inbound transform
  t.throws(
    () => client.replicationTransforms.get('Post').transformInbound(post1),
    {
      instanceOf: InvalidRecordTransformationError,
      message: 'Record transformation modified immutable fields: authorId',
    }
  )
})

test('setReplicationTransform should validate transform does not modify incoming FK column', async (t: any) => {
  await makeContext(t, 'main')

  const { adapter, notifier, satellite, client } = t.context

  const electric = await ElectricClient.create(
    'testDB',
    schema,
    adapter,
    notifier,
    satellite,
    globalRegistry,
    'SQLite'
  )

  const userTable = electric.db.User

  const modifyUserId = (user: any) => ({
    ...user,
    id: 9, // this is the column pointed at by the FK, should not be allowed to modify it
  })

  // postTable, userTable
  userTable.setReplicationTransform({
    transformInbound: modifyUserId,
    transformOutbound: modifyUserId,
  })

  // Check outbound transform
  t.throws(
    () => client.replicationTransforms.get('User').transformOutbound(author1),
    {
      instanceOf: InvalidRecordTransformationError,
      message: 'Record transformation modified immutable fields: id',
    }
  )

  // Also check inbound transform
  t.throws(
    () => client.replicationTransforms.get('User').transformInbound(author1),
    {
      instanceOf: InvalidRecordTransformationError,
      message: 'Record transformation modified immutable fields: id',
    }
  )
})
