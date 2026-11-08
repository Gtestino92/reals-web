import { expect, it } from 'vitest';
import { tabOwnershipEnabled } from './policy';
it.each([
  [true, 'localhost', undefined, false], [true, '127.0.0.1', 'false', false], [true, '[::1]', undefined, false],
  [true, 'localhost', 'true', true], [false, 'localhost', undefined, true], [false, '127.0.0.1', 'false', true],
  [true, 'dev.reals.test', 'false', true], [false, 'reals.test', 'false', true], [true, 'localhost.evil.test', undefined, true],
])('dev=%s host=%s optIn=%s enforces=%s', (dev, host, optIn, expected) => {
  expect(tabOwnershipEnabled(dev, host, optIn)).toBe(expected);
});
