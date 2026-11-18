export class StoreConflictError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 409) {
    super(message);
    this.name = 'StoreConflictError';
    this.statusCode = statusCode;
  }
}
