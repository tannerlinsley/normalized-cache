# Normalized Cache

This normalized cache provides the following functionality:

- Data (de)normalization
- Data subscriptions
- Data validation
- Data invalidation
- Data expiration
- Computed fields
- Optimistic updates
- Garbage collection

The library is around 5 KB gzipped.

## Setup

Installation:

```sh
npm install --save normalized-cache
```

## Usage

```js
import { Cache, schema } from "normalized-cache";

const Author = schema.object({
  name: "Author",
});

const Post = schema.object({
  name: "Post",
  fields: {
    author: Author,
  },
});

const cache = new Cache({
  types: [Post],
});

cache.write({
  type: "Post",
  data: {
    id: "1",
    title: "Title",
    author: {
      id: "2",
      name: "Name",
    },
  },
});

const { data } = cache.read({
  type: "Post",
  id: "1",
});

const { data } = cache.read({
  type: "Author",
  id: "2",
});
```

## API

```ts
class Cache {
  get(entityID: string, optimistic?: boolean): Entity | undefined;
  set(entity: Entity, optimistic?: boolean): Entity;
  identify(options: IdentifyOptions): string | undefined;
  read(options: ReadOptions): ReadResult;
  write(options: WriteOptions): WriteResult;
  delete(options: DeleteOptions): DeleteResult;
  invalidate(options: InvalidateOptions): InvalidateResult;
  watch(options: WatchOptions): UnsubscribeFn;
  silent(fn: () => void): void;
  transaction(fn: () => void): void;
  reset(): void;
  gc(): void;
  retain(entityID: string): DisposeFn;
  addOptimisticUpdate(updateFn: OptimisticUpdateFn): number;
  removeOptimisticUpdate(id: number): void;
}

const schema = {
  array(config?: ArrayTypeConfig | ValueType): ArrayType
  boolean(config?: BooleanTypeConfig): BooleanType
  nonNullable(config: NonNullableTypeConfig | ValueType): NonNullableType
  number(config?: NumberTypeConfig): NumberType
  object(config?: ObjectTypeConfig): ObjectType
  string(config?: StringTypeConfig | string): StringType
  union(config: UnionTypeConfig | ValueType[]): UnionType
}
```

## Schema

Schema types allow you to define entities, relationships and fields.

Learn more about the type system [here](./docs/Schema.md).

## Writing

When writing to the cache, a type must be provided.

```js
cache.write({
  type: "Post",
  data: { id: "1", title: "Title" },
});
```

A ID can be specified if this cannot be inferred from the data itself:

```js
cache.write({
  type: "Post",
  id: "1",
  data: { title: "Title" },
});
```

If the ID is an object or array it will be automatically serialized to a stable string:

```js
cache.write({
  type: "Posts",
  id: { page: 1, limit: 10 },
  data: [],
});
```

## Reading

Reading from the cache can be done with the `read` method.

When no selector is given, all fields and related entities will be returned:

```js
const { data } = cache.read({
  type: "Post",
  id: "1",
});
```

### Selectors

Selectors can be used to select specific fields to a certain depth:

```js
import { cql } from "normalized-cache";

const { data } = cache.read({
  type: "Post",
  id: "1",
  select: cql`{ title comments { text } }`,
});
```

Use the star operator to select all fields on a certain level:

```js
const { data } = cache.read({
  type: "Post",
  id: "1",
  select: cql`{ * comments { text } }`,
});
```

Quotes can be used to specify non-aplhanumeric fields:

```js
const { data } = cache.read({
  type: "Post",
  id: "1",
  select: cql`{ "field with spaces" { text } }`,
});
```

Fields can also be aliased:

```js
const { data } = cache.read({
  type: "Post",
  id: "1",
  select: cql`{ myTitle: title } }`,
});
```

Learn more about CQL [here](./docs/CQL.md).

### Computed fields

Computed fields can be created by defining a field with a `read` function.

Defining a computed field for calculations:

```js
const Cart = schema.object({
  name: "Cart",
  fields: {
    totalPrice: {
      read: (cart) => {
        return cart.lineItems.reduce((total, item) => total + item.price, 0);
      },
    },
  },
});
```

Defining a relational field based on another field:

```js
const Author = schema.object({
  name: "Author",
});

const Post = schema.object({
  name: "Post",
  fields: {
    author: {
      read: (post, { toReference }) => {
        return toReference({ type: "Author", id: post.authorId });
      },
    },
  },
});
```

### Invalid fields

Fields that do not match with the schema will be reported in the `invalidFields` array:

```js
const LoggedIn = schema.boolean({ name: "LoggedIn" })

const cache = new Cache({ types: [LoggedIn] });

cache.write({ type: "LoggedIn" data: "string" });

const { invalidFields } = cache.read({ type: "LoggedIn" });

if (invalidFields) {
  console.log("Invalid data");
}
```

### Missing fields

Fields that are missing will be reported in the `missingFields` array:

```js
const LoggedIn = schema.boolean({ name: "LoggedIn" });

const cache = new Cache({ types: [LoggedIn] });

const { missingFields } = cache.read({ type: "LoggedIn" });

if (missingFields) {
  console.log("Missing data");
}
```

### Stale flag

The `stale` flag indicates if some entity or field has been invalidated or if any `expiresAt` has past:

```js
const LoggedIn = schema.boolean({ name: "LoggedIn" });

const cache = new Cache({ types: [LoggedIn] });

cache.write({ type: "LoggedIn" data: true, expiresAt: 0 });

const { stale } = cache.read({ type: "LoggedIn" });

if (stale) {
  console.log("Stale data");
}
```

## Watching

Data in the cache can be watched with the `watch` method.

Watching for any change in a specific post and all related data:

```js
const unsubscribe = cache.watch({
  type: "Post",
  id: "1",
  callback: (result, prevResult) => {
    // log
  },
});

unsubscribe();
```

Watching specific fields:

```js
cache.watch({
  type: "Post",
  id: "1",
  select: cql`{ title }`,
  callback: (result, prevResult) => {
    if (!prevResult.stale && result.stale) {
      // The title became stale
    }
  },
});
```

## Invalidation

Entities and fields can be invalidated with the `invalidate` method.

When an entity or field is invalidated, all related watchers will be notified.

Invalidate an entity:

```js
cache.invalidate({
  type: "Post",
  id: "1",
});
```

Invalidate entity fields:

```js
cache.invalidate({
  type: "Post",
  id: "1",
  select: cql`{ comments }`,
});
```

## Expiration

when `expiresAt` is specified, all affected fields will be considered stale after the given time:

```js
cache.write({
  type: "Post",
  data: { id: "1" },
  expiresAt: Date.now() + 60 * 1000,
});
```

Set expiration for certain types:

```js
cache.write({
  type: "Post",
  data: { id: "1" },
  expiresAt: {
    Comment: Date.now() + 60 * 1000,
  },
});
```

## Deletion

Entities and fields can be deleted with the `delete` method.

Deleting an entity:

```js
cache.delete({
  type: "Post",
  id: "1",
});
```

Deleting specific fields:

```js
cache.delete({
  type: "Post",
  id: "1",
  select: cql`{ title }`,
});
```

## Optimistic updates

An optimistic update function can be used to update the cache optimistically.

These functions will be executed everytime the cache is updated, until they are removed.

This means that if new data is written to the cache, the optimistic update will be re-applied / rebased on top of the new data.

```js
async function addComment(postID, text) {
  function addCommentToPost(comment) {
    const { data } = cache.read({
      type: "Post",
      id: postID,
      select: cql`{ comments }`,
    });

    cache.write({
      type: "Post",
      id: postID,
      data: { comments: [...data.comments, comment] },
    });
  }

  const updateID = cache.addOptimisticUpdate(() => {
    const optimisticComment = { id: uuid(), text };
    addCommentToPost(optimisticComment);
  });

  const comment = await api.addComment(postID, text);

  cache.transaction(() => {
    cache.removeOptimisticUpdate(updateID);
    addCommentToPost(comment);
  });
}
```

## Merging

By default entities are shallowly merged and non-entity values are replaced.

This behavior can be customized by defining custom write functions on entities and fields.

Replacing entities instead of merging:

```js
const Author = schema.object({
  name: "Author",
  write: (incoming) => {
    return incoming;
  },
});
```

Merging objects instead of replacing:

```js
const Post = schema.object({
  name: "Post",
  fields: {
    content: {
      type: schema.object(),
      write: (incoming, existing) => {
        return { ...existing, ...incoming };
      },
    },
  },
});
```

Transforming values when writing:

```js
const Post = schema.object({
  name: "Post",
  fields: {
    title: {
      write: (incoming) => {
        if (typeof incoming === "string") {
          return incoming.toUpperCase();
        }
      },
    },
  },
});
```

## Transactions

Multiple changes can be wrapped in a transaction to make sure watchers are only notified once after the last change:

```js
cache.transaction(() => {
  cache.write({ type: "Post", data: { id: "1", title: "1" } });
  cache.write({ type: "Post", data: { id: "2", title: "2" } });
});
```

## Silent changes

Wrap changes with `silent` to prevent watchers from being notified:

```js
cache.silent(() => {
  cache.write({ type: "Post", data: { id: "1", title: "1" } });
});
```

## Garbage collection

The `gc` method can be used to remove all unwatched and unreachable entities from the cache.

Use the `retain` method to prevent an entity from being removed.
