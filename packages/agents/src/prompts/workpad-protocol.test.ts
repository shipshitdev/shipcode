import { describe, expect, it } from 'vitest';
import { buildWorkpadProtocol, WORKPAD_MARKER, WORKPAD_SECTIONS } from './workpad-protocol';

describe('buildWorkpadProtocol', () => {
  it('includes the canonical marker', () => {
    const out = buildWorkpadProtocol({ issueNumber: 42 });
    expect(out).toContain(WORKPAD_MARKER);
    expect(out).toContain('## ShipCode Workpad');
  });

  it('mentions the target issue number', () => {
    const out = buildWorkpadProtocol({ issueNumber: 137 });
    expect(out).toContain('issue #137');
  });

  it('lists every required section', () => {
    const out = buildWorkpadProtocol({ issueNumber: 1 });
    for (const section of WORKPAD_SECTIONS) {
      expect(out).toContain(`### ${section}`);
    }
  });

  it('forbids per-phase summary comments', () => {
    const out = buildWorkpadProtocol({ issueNumber: 1 });
    expect(out).toMatch(/never post separate per-phase summary comments/i);
  });

  it('requires environment stamp at top', () => {
    const out = buildWorkpadProtocol({ issueNumber: 1 });
    expect(out).toContain('<host>:<abs-cwd>@<short-sha>');
  });

  it('forbids creating a second workpad on the same issue', () => {
    const out = buildWorkpadProtocol({ issueNumber: 1 });
    expect(out).toMatch(/never produce a second.*comment on the same issue/i);
  });
});
