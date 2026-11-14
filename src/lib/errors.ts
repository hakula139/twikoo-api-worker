import { DrizzleQueryError } from 'drizzle-orm';
import { RES_CODE as ResponseCode } from 'twikoo-func/utils/constants';

export { ResponseCode };

type ResponseCodeName = keyof typeof ResponseCode;

export type ResponseCodeValue = (typeof ResponseCode)[ResponseCodeName];

export class TwikooError extends Error {
  readonly code: ResponseCodeValue;

  constructor(code: ResponseCodeValue, message: string) {
    super(message);
    this.code = code;
    this.name = 'TwikooError';
  }
}

export const redactDatabaseError = (error: unknown): unknown =>
  error instanceof DrizzleQueryError ? new Error('Database request failed.') : error;
