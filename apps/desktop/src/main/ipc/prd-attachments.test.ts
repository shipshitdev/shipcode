import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  clearPrdAttachmentSession,
  createPrdAttachmentSession,
  getPrdAttachmentSessionSummary,
  PRD_ATTACHMENT_MAX_BYTES,
  PRD_ATTACHMENT_MAX_COUNT,
  removePrdAttachment,
  stagePrdAttachments,
} from './prd-attachments';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpFile(ext: string, content: Buffer): string {
  const name = `shipcode-test-${crypto.randomUUID().slice(0, 8)}${ext}`;
  const p = path.join(os.tmpdir(), name);
  fs.writeFileSync(p, content);
  return p;
}

// 8-byte PNG magic
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
// 3-byte JPEG magic
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
// GIF magic
const GIF_MAGIC = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00]);
// WebP magic: RIFF????WEBP
const WEBP_MAGIC = (() => {
  const b = Buffer.alloc(12);
  b.write('RIFF', 0, 'ascii');
  b.writeUInt32LE(0, 4);
  b.write('WEBP', 8, 'ascii');
  return b;
})();

const createdSessions: string[] = [];

function openSession(): string {
  const id = createPrdAttachmentSession('sender-1', 'project-1');
  createdSessions.push(id);
  return id;
}

const tmpFiles: string[] = [];

function tmpFile(ext: string, buf: Buffer): string {
  const p = makeTmpFile(ext, buf);
  tmpFiles.push(p);
  return p;
}

afterEach(() => {
  for (const id of createdSessions) {
    clearPrdAttachmentSession(id);
  }
  createdSessions.length = 0;
  for (const f of tmpFiles) {
    try {
      fs.unlinkSync(f);
    } catch {
      /* already removed */
    }
  }
  tmpFiles.length = 0;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('prd-attachments', () => {
  describe('createPrdAttachmentSession', () => {
    it('returns a uuid string', () => {
      const id = openSession();
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
    });

    it('creates an empty session', () => {
      const id = openSession();
      const summary = getPrdAttachmentSessionSummary(id);
      expect(summary).not.toBeNull();
      expect(summary?.attachments).toHaveLength(0);
    });
  });

  describe('stagePrdAttachments — happy path', () => {
    it('stages a valid PNG file', () => {
      const id = openSession();
      const png = tmpFile('.png', PNG_MAGIC);
      const result = stagePrdAttachments(id, [png]);
      expect(result.errors).toHaveLength(0);
      expect(result.staged).toHaveLength(1);
      expect(result.staged[0]?.mimeType).toBe('image/png');
      expect(result.staged[0]?.fileName).toBe(path.basename(png));
    });

    it('stages a valid JPEG file', () => {
      const id = openSession();
      const jpg = tmpFile('.jpg', JPEG_MAGIC);
      const result = stagePrdAttachments(id, [jpg]);
      expect(result.errors).toHaveLength(0);
      expect(result.staged[0]?.mimeType).toBe('image/jpeg');
    });

    it('stages a valid GIF file', () => {
      const id = openSession();
      const gif = tmpFile('.gif', GIF_MAGIC);
      const result = stagePrdAttachments(id, [gif]);
      expect(result.errors).toHaveLength(0);
      expect(result.staged[0]?.mimeType).toBe('image/gif');
    });

    it('stages a valid WebP file', () => {
      const id = openSession();
      const webp = tmpFile('.webp', WEBP_MAGIC);
      const result = stagePrdAttachments(id, [webp]);
      expect(result.errors).toHaveLength(0);
      expect(result.staged[0]?.mimeType).toBe('image/webp');
    });

    it('accumulates attachments across calls', () => {
      const id = openSession();
      const png1 = tmpFile('.png', PNG_MAGIC);
      const png2 = tmpFile('.png', PNG_MAGIC);
      stagePrdAttachments(id, [png1]);
      stagePrdAttachments(id, [png2]);
      const summary = getPrdAttachmentSessionSummary(id);
      expect(summary?.attachments).toHaveLength(2);
    });
  });

  describe('stagePrdAttachments — rejection cases', () => {
    it('rejects symlinks', () => {
      const id = openSession();
      const target = tmpFile('.png', PNG_MAGIC);
      const linkPath = path.join(
        os.tmpdir(),
        `shipcode-sym-${crypto.randomUUID().slice(0, 8)}.png`,
      );
      fs.symlinkSync(target, linkPath);
      tmpFiles.push(linkPath);

      const result = stagePrdAttachments(id, [linkPath]);
      expect(result.staged).toHaveLength(0);
      expect(result.errors[0]).toMatch(/symlinks/i);
    });

    it('rejects directory symlinks', () => {
      const id = openSession();
      const dirPath = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-dir-'));
      const linkPath = path.join(
        os.tmpdir(),
        `shipcode-sym-dir-${crypto.randomUUID().slice(0, 8)}`,
      );
      fs.symlinkSync(dirPath, linkPath);
      tmpFiles.push(linkPath, dirPath);

      const result = stagePrdAttachments(id, [linkPath]);
      expect(result.staged).toHaveLength(0);
      expect(result.errors[0]).toMatch(/symlinks/i);
    });

    it('rejects files with invalid magic bytes', () => {
      const id = openSession();
      const txt = tmpFile('.png', Buffer.from('not an image at all here!!'));
      const result = stagePrdAttachments(id, [txt]);
      expect(result.staged).toHaveLength(0);
      expect(result.errors[0]).toMatch(/unsupported file type/i);
    });

    it('rejects duplicate attachments', () => {
      const id = openSession();
      const png = tmpFile('.png', PNG_MAGIC);
      stagePrdAttachments(id, [png]);
      const result = stagePrdAttachments(id, [png]);
      expect(result.staged).toHaveLength(0);
      expect(result.errors[0]).toMatch(/already attached/i);
    });

    it('rejects files that exceed the size limit', () => {
      const id = openSession();
      const bigBuf = Buffer.concat([PNG_MAGIC, Buffer.alloc(PRD_ATTACHMENT_MAX_BYTES)]);
      const big = tmpFile('.png', bigBuf);
      const result = stagePrdAttachments(id, [big]);
      expect(result.staged).toHaveLength(0);
      expect(result.errors[0]).toMatch(/exceeds/i);
    });

    it('stops staging when max count is reached', () => {
      const id = openSession();
      const files = Array.from({ length: PRD_ATTACHMENT_MAX_COUNT + 2 }, () =>
        tmpFile('.png', PNG_MAGIC),
      );
      const result = stagePrdAttachments(id, files);
      expect(result.staged).toHaveLength(PRD_ATTACHMENT_MAX_COUNT);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('errors on non-existent path', () => {
      const id = openSession();
      const result = stagePrdAttachments(id, ['/non-existent-path/no-such-file.png']);
      expect(result.staged).toHaveLength(0);
      expect(result.errors[0]).toMatch(/file not found/i);
    });
  });

  describe('removePrdAttachment', () => {
    it('removes an attachment by originalPath', () => {
      const id = openSession();
      const png = tmpFile('.png', PNG_MAGIC);
      const { staged } = stagePrdAttachments(id, [png]);
      expect(staged).toHaveLength(1);

      removePrdAttachment(id, staged[0]?.originalPath);
      const summary = getPrdAttachmentSessionSummary(id);
      expect(summary?.attachments).toHaveLength(0);
    });

    it('deletes the staged copy on removal', () => {
      const id = openSession();
      const png = tmpFile('.png', PNG_MAGIC);
      const { staged } = stagePrdAttachments(id, [png]);
      const stagedPath = staged[0]?.stagedPath;
      expect(fs.existsSync(stagedPath)).toBe(true);

      removePrdAttachment(id, staged[0]?.originalPath);
      expect(fs.existsSync(stagedPath)).toBe(false);
    });
  });

  describe('clearPrdAttachmentSession', () => {
    it('removes all attachments and the temp dir', () => {
      const id = openSession();
      const summary = getPrdAttachmentSessionSummary(id);
      const tmpDir = (summary as unknown as { tmpDir?: string })?.tmpDir;

      const png = tmpFile('.png', PNG_MAGIC);
      const { staged } = stagePrdAttachments(id, [png]);
      const stagedPath = staged[0]?.stagedPath;

      clearPrdAttachmentSession(id);

      expect(getPrdAttachmentSessionSummary(id)).toBeNull();
      expect(fs.existsSync(stagedPath)).toBe(false);
      if (tmpDir) expect(fs.existsSync(tmpDir)).toBe(false);
    });

    it('is idempotent (no throw on double-clear)', () => {
      const id = openSession();
      clearPrdAttachmentSession(id);
      expect(() => clearPrdAttachmentSession(id)).not.toThrow();
    });
  });
});
