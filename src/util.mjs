import { createHash, randomUUID } from 'node:crypto';

export class AppError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
export const id = () => randomUUID();
export const hash = (value) =>
  createHash('sha256')
    .update(typeof value === 'string' ? value : JSON.stringify(value))
    .digest('hex');
export const iso = () => new Date().toISOString();
export function assert(value, message, status = 400) {
  if (!value) throw new AppError(message, status);
}
export function text(value, name, max = 2000) {
  assert(
    typeof value === 'string' && value.trim().length && value.length <= max,
    `${name} must be 1–${max} characters.`,
  );
  return value.trim();
}
export function integer(value, name, min = 0, max = Number.MAX_SAFE_INTEGER) {
  assert(
    Number.isSafeInteger(value) && value >= min && value <= max,
    `${name} must be an integer between ${min} and ${max}.`,
  );
  return value;
}
export function json(value, fallback = null) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}
export const micros = (dollars) => Math.ceil(dollars * 1_000_000);
export const dollars = (value) => (value / 1_000_000).toFixed(4);
