import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  clearPrdAttachmentSession,
  createPrdAttachmentSession,
  stagePrdAttachments,
} from './prd-attachments';

function pngBytes(): Buffer {
  return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00]);
}

describe('prd-attachments', () => {
  let projectDir: string;
  let outsideDir: string;
  let sessionId: string;

  beforeEach(async () => {
    projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shipcode-prd-attachments-project-'));
    outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shipcode-prd-attachments-outside-'));
    sessionId = createPrdAttachmentSession({ senderId: 1, projectId: 'project-1' }).attachmentSessionId;
  });

  afterEach(async () => {
    await clearPrdAttachmentSession({
      senderId: 1,
      projectId: 'project-1',
      attachmentSessionId: sessionId,
    }).catch(() => {});
    await fs.rm(projectDir, { recursive: true, force: true });
    await fs.rm(outsideDir, { recursive: true, force: true });
  });

  it('rejects symlinked inputs', async () => {
    const imagePath = path.join(projectDir, 'image.png');
    const linkPath = path.join(projectDir, 'image-link.png');
    await fs.writeFile(imagePath, pngBytes());
    await fs.symlink(imagePath, linkPath);

    await expect(
      stagePrdAttachments({
        senderId: 1,
        projectId: 'project-1',
        attachmentSessionId: sessionId,
        paths: [linkPath],
      }),
    ).rejects.toThrow(/Symlinked attachments|Redirected attachments|regular file/i);
  });

  it('rejects redirected directory inputs', async () => {
    const imagePath = path.join(outsideDir, 'image.png');
    await fs.writeFile(imagePath, pngBytes());
    const linkDir = path.join(projectDir, 'alias');
    await fs.symlink(outsideDir, linkDir);

    await expect(
      stagePrdAttachments({
        senderId: 1,
        projectId: 'project-1',
        attachmentSessionId: sessionId,
        paths: [path.join(linkDir, 'image.png')],
      }),
    ).rejects.toThrow(/Symlinked attachments|Redirected attachments/i);
  });

  it('rejects files whose bytes do not match an allowed image signature', async () => {
    const fakeImage = path.join(projectDir, 'fake.png');
    await fs.writeFile(fakeImage, 'not a png');

    await expect(
      stagePrdAttachments({
        senderId: 1,
        projectId: 'project-1',
        attachmentSessionId: sessionId,
        paths: [fakeImage],
      }),
    ).rejects.toThrow(/Only PNG, JPEG, GIF, or WebP images are allowed/i);
  });

  it('copies approved images into the app-owned temp area', async () => {
    const imagePath = path.join(projectDir, 'image.png');
    const bytes = pngBytes();
    await fs.writeFile(imagePath, bytes);

    const result = await stagePrdAttachments({
      senderId: 1,
      projectId: 'project-1',
      attachmentSessionId: sessionId,
      paths: [imagePath],
    });

    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0]).toEqual(
      expect.objectContaining({
        name: 'image.png',
        mimeType: 'image/png',
        size: bytes.length,
      }),
    );

    const stagedDir = path.join(os.tmpdir(), 'shipcode-prd-attachments', sessionId);
    const stagedFile = (await fs.readdir(stagedDir)).find((file) => file.endsWith('.png'));
    expect(stagedFile).toBeTruthy();
    const stagedBytes = await fs.readFile(path.join(stagedDir, stagedFile!));
    expect(stagedBytes).toEqual(bytes);
  });
});
