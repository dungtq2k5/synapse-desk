import type { MaybeJwtPayload } from '@synapsedesk/common';

// Passport writes the value returned by JwtStrategy.validate() to req.user.
// Merging here makes that contract visible to every consumer, with no casts.
declare global {
  namespace Express {
    // Must be `interface ... extends`, not `type User = ...`. @types/passport
    // already declares `interface User {}` here, and only interfaces merge — a
    // type alias does not, so `req.user` silently stayed the empty `{}`.
    //
    // MaybeJwtPayload, not JwtPayload: JwtStrategy and Jwt2faStrategy write
    // different shapes, so consumers must narrow with `isFullJwtPayload` before
    // reading anything beyond `sub`.
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface User extends MaybeJwtPayload {}
  }
}

export {};
