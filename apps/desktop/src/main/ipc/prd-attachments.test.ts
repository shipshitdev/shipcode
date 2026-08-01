import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearPrdAttachmentSession,
  createPrdAttachmentSession,
  getPrdAttachmentSessionSummary,
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
const PRD_ATTACHMENT_MAX_COUNT = 6;
const PRD_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

async function openSession(): Promise<string> {
  const id = await createPrdAttachmentSession('sender-1', 'project-1');
  createdSessions.push(id);
  return id;
}

const tmpFiles: string[] = [];

function tmpFile(ext: string, buf: Buffer): string {
  const p = makeTmpFile(ext, buf);
  tmpFiles.push(p);
  return p;
}

afterEach(async () => {
  for (const id of createdSessions) {
    await clearPrdAttachmentSession(id);
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
    it('returns a uuid string', async () => {
      const id = await openSession();
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
    });

    it('creates an empty session', async () => {
      const id = await openSession();
      const summary = getPrdAttachmentSessionSummary(id);
      expect(summary).not.toBeNull();
      expect(summary?.attachments).toHaveLength(0);
    });
  });

  describe('stagePrdAttachments — happy path', () => {
    it('stages a valid PNG file', async () => {
      const id = await openSession();
      const png = tmpFile('.png', PNG_MAGIC);
      const result = await stagePrdAttachments(id, [png]);
      expect(result.errors).toHaveLength(0);
      expect(result.staged).toHaveLength(1);
      expect(result.staged[0]?.mimeType).toBe('image/png');
      expect(result.staged[0]?.fileName).toBe(path.basename(png));
    });

    it('stages a valid JPEG file', async () => {
      const id = await openSession();
      const jpg = tmpFile('.jpg', JPEG_MAGIC);
      const result = await stagePrdAttachments(id, [jpg]);
      expect(result.errors).toHaveLength(0);
      expect(result.staged[0]?.mimeType).toBe('image/jpeg');
    });

    it('stages a valid GIF file', async () => {
      const id = await openSession();
      const gif = tmpFile('.gif', GIF_MAGIC);
      const result = await stagePrdAttachments(id, [gif]);
      expect(result.errors).toHaveLength(0);
      expect(result.staged[0]?.mimeType).toBe('image/gif');
    });

    it('stages a valid WebP file', async () => {
      const id = await openSession();
      const webp = tmpFile('.webp', WEBP_MAGIC);
      const result = await stagePrdAttachments(id, [webp]);
      expect(result.errors).toHaveLength(0);
      expect(result.staged[0]?.mimeType).toBe('image/webp');
    });

    it('accumulates attachments across calls', async () => {
      const id = await openSession();
      const png1 = tmpFile('.png', PNG_MAGIC);
      const png2 = tmpFile('.png', PNG_MAGIC);
      await stagePrdAttachments(id, [png1]);
      await stagePrdAttachments(id, [png2]);
      const summary = getPrdAttachmentSessionSummary(id);
      expect(summary?.attachments).toHaveLength(2);
    });

    it('reports the closure when the session is cleared mid-stage', async () => {
      const id = await openSession();
      const png = tmpFile('.png', PNG_MAGIC);

      // Clear the session while the copy is still in flight: its temp dir (and
      // the copy inside it) is gone, so nothing may be recorded against it.
      const copySpy = vi.spyOn(fsp, 'copyFile').mockImplementationOnce(async () => {
        await clearPrdAttachmentSession(id);
      });

      const result = await stagePrdAttachments(id, [png]);
      copySpy.mockRestore();

      expect(result.staged).toHaveLength(0);
      expect(result.errors).toContain('Attachment session was closed');
      expect(getPrdAttachmentSessionSummary(id)).toBeNull();
    });
  });

  describe('stagePrdAttachments — rejection cases', () => {
    it('rejects symlinks', async () => {
      const id = await openSession();
      const target = tmpFile('.png', PNG_MAGIC);
      const linkPath = path.join(
        os.tmpdir(),
        `shipcode-sym-${crypto.randomUUID().slice(0, 8)}.png`,
      );
      fs.symlinkSync(target, linkPath);
      tmpFiles.push(linkPath);

      const result = await stagePrdAttachments(id, [linkPath]);
      expect(result.staged).toHaveLength(0);
      expect(result.errors[0]).toMatch(/symlinks/i);
    });

    it('rejects directory symlinks', async () => {
      const id = await openSession();
      const dirPath = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-dir-'));
      const linkPath = path.join(
        os.tmpdir(),
        `shipcode-sym-dir-${crypto.randomUUID().slice(0, 8)}`,
      );
      fs.symlinkSync(dirPath, linkPath);
      tmpFiles.push(linkPath, dirPath);

      const result = await stagePrdAttachments(id, [linkPath]);
      expect(result.staged).toHaveLength(0);
      expect(result.errors[0]).toMatch(/symlinks/i);
    });

    it('rejects files with invalid magic bytes', async () => {
      const id = await openSession();
      const txt = tmpFile('.png', Buffer.from('not an image at all here!!'));
      const result = await stagePrdAttachments(id, [txt]);
      expect(result.staged).toHaveLength(0);
      expect(result.errors[0]).toMatch(/unsupported file type/i);
    });

    it('rejects duplicate attachments', async () => {
      const id = await openSession();
      const png = tmpFile('.png', PNG_MAGIC);
      await stagePrdAttachments(id, [png]);
      const result = await stagePrdAttachments(id, [png]);
      expect(result.staged).toHaveLength(0);
      expect(result.errors[0]).toMatch(/already attached/i);
    });

    it('rejects files that exceed the size limit', async () => {
      const id = await openSession();
      const bigBuf = Buffer.concat([PNG_MAGIC, Buffer.alloc(PRD_ATTACHMENT_MAX_BYTES)]);
      const big = tmpFile('.png', bigBuf);
      const result = await stagePrdAttachments(id, [big]);
      expect(result.staged).toHaveLength(0);
      expect(result.errors[0]).toMatch(/exceeds/i);
    });

    it('stops staging when max count is reached', async () => {
      const id = await openSession();
      const files = Array.from({ length: PRD_ATTACHMENT_MAX_COUNT + 2 }, () =>
        tmpFile('.png', PNG_MAGIC),
      );
      const result = await stagePrdAttachments(id, files);
      expect(result.staged).toHaveLength(PRD_ATTACHMENT_MAX_COUNT);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('errors on non-existent path', async () => {
      const id = await openSession();
      const result = await stagePrdAttachments(id, ['/non-existent-path/no-such-file.png']);
      expect(result.staged).toHaveLength(0);
      expect(result.errors[0]).toMatch(/file not found/i);
    });

    it('rejects directories and missing attachment sessions', async () => {
      const id = await openSession();
      const dirPath = fs.mkdtempSync(path.join(os.tmpdir(), 'shipcode-attachment-dir-'));
      tmpFiles.push(dirPath);

      const result = await stagePrdAttachments(id, [dirPath]);
      expect(result.staged).toHaveLength(0);
      expect(result.errors[0]).toMatch(/directories are not allowed/i);
      await expect(stagePrdAttachments('missing-session', [])).rejects.toThrow(
        'No attachment session: missing-session',
      );
    });

    it('reports read and copy failures while staging', async () => {
      const id = await openSession();
      const readFail = tmpFile('.png', PNG_MAGIC);
      const openSpy = vi.spyOn(fsp, 'open').mockImplementationOnce(() => {
        throw new Error('cannot open');
      });

      const readResult = await stagePrdAttachments(id, [readFail]);
      expect(readResult.staged).toHaveLength(0);
      expect(readResult.errors[0]).toMatch(/cannot read file/i);
      openSpy.mockRestore();

      const partialRead = tmpFile('.png', PNG_MAGIC);
      const closeSpy = vi.fn(async () => undefined);
      const handleSpy = vi.spyOn(fsp, 'open').mockImplementationOnce(
        async () =>
          ({
            read: async () => {
              throw new Error('read failed');
            },
            close: closeSpy,
          }) as unknown as Awaited<ReturnType<typeof fsp.open>>,
      );

      const partialReadResult = await stagePrdAttachments(id, [partialRead]);
      expect(partialReadResult.staged).toHaveLength(0);
      expect(partialReadResult.errors[0]).toMatch(/cannot read file/i);
      expect(closeSpy).toHaveBeenCalledTimes(1);
      handleSpy.mockRestore();

      const copyFail = tmpFile('.png', PNG_MAGIC);
      const copySpy = vi.spyOn(fsp, 'copyFile').mockImplementationOnce(() => {
        throw new Error('copy failed');
      });

      const copyResult = await stagePrdAttachments(id, [copyFail]);
      expect(copyResult.staged).toHaveLength(0);
      expect(copyResult.errors[0]).toMatch(/failed to stage file/i);
      copySpy.mockRestore();
    });
  });

  describe('removePrdAttachment', () => {
    it('removes an attachment by originalPath', async () => {
      const id = await openSession();
      const png = tmpFile('.png', PNG_MAGIC);
      const { staged } = await stagePrdAttachments(id, [png]);
      expect(staged).toHaveLength(1);

      await removePrdAttachment(id, staged[0]?.originalPath);
      const summary = getPrdAttachmentSessionSummary(id);
      expect(summary?.attachments).toHaveLength(0);
    });

    it('deletes the staged copy on removal', async () => {
      const id = await openSession();
      const png = tmpFile('.png', PNG_MAGIC);
      const { staged } = await stagePrdAttachments(id, [png]);
      const stagedPath = staged[0]?.stagedPath;
      expect(fs.existsSync(stagedPath)).toBe(true);

      await removePrdAttachment(id, staged[0]?.originalPath);
      expect(fs.existsSync(stagedPath)).toBe(false);
    });

    it('removes by stagedPath, ignores missing attachments, and tolerates unlink failures', async () => {
      const id = await openSession();
      const png = tmpFile('.png', PNG_MAGIC);
      const { staged } = await stagePrdAttachments(id, [png]);
      expect(staged).toHaveLength(1);

      await removePrdAttachment(id, '/tmp/not-attached.png');
      expect(getPrdAttachmentSessionSummary(id)?.attachments).toHaveLength(1);

      const unlinkSpy = vi.spyOn(fsp, 'unlink').mockImplementationOnce(() => {
        throw new Error('unlink failed');
      });
      await removePrdAttachment(id, staged[0]?.stagedPath);
      expect(getPrdAttachmentSessionSummary(id)?.attachments).toHaveLength(0);
      unlinkSpy.mockRestore();

      await expect(removePrdAttachment('missing-session', png)).rejects.toThrow(
        'No attachment session: missing-session',
      );
    });
  });

  describe('clearPrdAttachmentSession', () => {
    it('removes all attachments and the temp dir', async () => {
      const id = await openSession();
      const summary = getPrdAttachmentSessionSummary(id);
      const tmpDir = (summary as unknown as { tmpDir?: string })?.tmpDir;

      const png = tmpFile('.png', PNG_MAGIC);
      const { staged } = await stagePrdAttachments(id, [png]);
      const stagedPath = staged[0]?.stagedPath;

      await clearPrdAttachmentSession(id);

      expect(getPrdAttachmentSessionSummary(id)).toBeNull();
      expect(fs.existsSync(stagedPath)).toBe(false);
      if (tmpDir) expect(fs.existsSync(tmpDir)).toBe(false);
    });

    it('is idempotent (no throw on double-clear)', async () => {
      const id = await openSession();
      await clearPrdAttachmentSession(id);
      await expect(clearPrdAttachmentSession(id)).resolves.toBeUndefined();
    });

    it('tolerates temp directory cleanup failures', async () => {
      const id = await openSession();
      const rmSpy = vi.spyOn(fsp, 'rm').mockImplementationOnce(() => {
        throw new Error('rm failed');
      });

      await expect(clearPrdAttachmentSession(id)).resolves.toBeUndefined();
      expect(getPrdAttachmentSessionSummary(id)).toBeNull();
      rmSpy.mockRestore();
    });
  });
});
