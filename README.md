# effect/Schema to Avro compiler

This is active work in progress.  
Main goal is to have a way to serialize and deserialize effect/Schema types via intermediate binary Avro representaion.

## Why

Although JSON is sufficient enough for many use cases, Avro codec has some unique advantages

1. Smaller payload - no overhead for JSON syntax
2. Schema evolution  
JSON is all-or-nothing format - it's impossible to implement conditional reads without reading and parsing the whole document.
With Avro being schema-based binary representation it's possible to skip to an arbitrary part of the document and run a check on it before ingesting the rest.  
This code will parse and check Post id to be 1 and only then decode full document, which is impossible with JSON.
```ts
const Id = S.Struct({ id: Post.fields.id })

const newPost = new Post({
  id: 1,
  author: new User({ name: `John Doe`, id: 1, email: `john.doe@example.com` }),
})

const PostAvro = yield* avro(Post, { evolve: { schema: Id, test: (a) => a.id === 1 } })

const encodePost = S.encodeSync(PostAvro)
const decodePost = S.decodeSync(PostAvro)

postsEqual(newPost, decodePost(encodePost(newPost)))
```

