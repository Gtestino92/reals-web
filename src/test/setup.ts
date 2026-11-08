import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(cleanup);

// jsdom has no modal top layer; behavior/focus trapping is checked in Chromium.
if (typeof HTMLDialogElement !== 'undefined' && !HTMLDialogElement.prototype.showModal) Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function(this: HTMLDialogElement) { this.open = true; } });
if (typeof HTMLDialogElement !== 'undefined' && !HTMLDialogElement.prototype.close) Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function(this: HTMLDialogElement) { this.open = false; } });
// Keep failures actionable without printing entire Home/onboarding DOM trees.
process.env.DEBUG_PRINT_LIMIT ??= '1500';
