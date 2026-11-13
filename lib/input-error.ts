export class InputError extends Error {
  public status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'InputError';
    this.status = status;
  }
}
