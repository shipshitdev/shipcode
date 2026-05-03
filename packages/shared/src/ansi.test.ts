import { describe, expect, it } from 'vitest';
import { stripAnsi } from './ansi';

describe('stripAnsi', () => {
  it('removes CSI color escapes', () => {
    expect(stripAnsi('\u001b[31merror\u001b[0m')).toBe('error');
  });

  it('preserves OSC-8 hyperlink labels', () => {
    const input = '\u001b]8;;https://example.com\u001b\\label\u001b]8;;\u001b\\';

    expect(stripAnsi(input)).toBe('label');
  });

  it('strips BEL-terminated OSC sequences', () => {
    expect(stripAnsi('\u001b]0;ShipCode\u0007ready')).toBe('ready');
  });
});
