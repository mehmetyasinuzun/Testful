export const EXIT = { OK: 0, NOT_READY: 1, USAGE: 2, ENV: 3 };

export class UsageError extends Error {
  constructor(msg) { super(msg); this.exitCode = EXIT.USAGE; }
}

export class EnvError extends Error {
  constructor(msg) { super(msg); this.exitCode = EXIT.ENV; }
}
