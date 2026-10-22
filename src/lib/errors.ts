// src/lib/errors.ts
/** An error whose message is safe to show to end users. Anything else is treated as internal. */
export class UserFacingError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "UserFacingError";
    }
  }