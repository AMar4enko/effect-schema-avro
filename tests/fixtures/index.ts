import { Schema as S } from 'effect'

export class Content extends S.TaggedClass<Content>()(`Content`, {
  id: S.Number,
  url: S.String,
}) {}

export class User extends S.Class<User>(`User`)({
  id: S.Number,
  name: S.String,
  email: S.String,
}) {}

export class Post extends S.Class<Post>(`Post`)({
  id: S.Number,
  // content: S.Uint8ArrayFromSelf,
  test: S.String,
  // author: User,
}) {}
