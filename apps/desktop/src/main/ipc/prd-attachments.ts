import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { StagedPrdAttachment } from '@shipcode/shared';

const ATTACHMENT_ROOT = path.join(os.tmpdir(), 'shipcode-prd-attachments');

export const PRD_ATTACHMENT_MAX_COUNT = 6;
export const PRD_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

interface InternalAttachment extends StagedPrdAttachment {
  sourcePath: string;
  stagedPath: string;
}

interface AttachmentSessionRecord {
  senderId: number;
  projectId: string;
  tempDir: string;
  attachments: InternalAttachment[];
}

const sessions = new Map<string, AttachmentSessionRecord>();

function attachmentError(message: string): Error {
  return new Error(message);
}

function toPublicAttachment(attachment: InternalAttachment): StagedPrdAttachment {
  return {
    id: attachment.id,
    name: attachment.name,
    size: attachment.size,
    mimeType: attachment.mimeType,
  };
}

function getSessionOrThrow(opts: {
  senderId: number;
  projectId: string;
  attachmentSessionId: string;
}): AttachmentSessionRecord {
  const session = sessions.get(opts.attachmentSessionId);
  if (!session) throw attachmentError('Attachment session not found.');
  if (session.senderId !== opts.senderId || session.projectId !== opts.projectId) {
    throw attachmentError('Attachment session mismatch.');
  }
  return session;
}

async function ensureTempDir(session: AttachmentSessionRecord): Promise<void> {
  await fs.mkdir(session.tempDir, { recursive: true });
}

function detectImageMimeType(bytes: Buffer): StagedPrdAttachment['mimeType'] | null {
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 6 &&
    (bytes.subarray(0, 6).toString('ascii') === 'GIF87a' ||
      bytes.subarray(0, 6).toString('ascii') === 'GIF89a')
  ) {
    return 'image/gif';
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

function mimeTypeToExtension(mimeType: StagedPrdAttachment['mimeType']): string {
  switch (mimeType) {
    case 'image/png':
      return '.png';
    case 'image/jpeg':
      return '.jpg';
    case 'image/gif':
      return '.gif';
    case 'image/webp':
      return '.webp';
  }
}

function normalizePathForComparison(value: string): string {
  return value.replace(/^\/private(?=\/)/, '');
}

async function validateAndPrepareSource(rawPath: string): Promise<{
  name: string;
  realPath: string;
  size: number;
  mimeType: StagedPrdAttachment['mimeType'];
}> {
  if (typeof rawPath !== 'string' || rawPath.trim() === '') {
    throw attachmentError('Attachment path must be a non-empty string.');
  }
  if (!path.isAbsolute(rawPath)) {
    throw attachmentError('Attachment path must be absolute.');
  }

  const resolvedPath = path.resolve(rawPath);
  const sourceStat = await fs.lstat(resolvedPath);
  if (sourceStat.isSymbolicLink()) {
    throw attachmentError('Symlinked attachments are not allowed.');
  }
  if (!sourceStat.isFile()) {
    throw attachmentError('Attachment must be a regular file.');
  }

  const realPath = await fs.realpath(resolvedPath);
  if (normalizePathForComparison(realPath) !== normalizePathForComparison(resolvedPath)) {
    throw attachmentError('Redirected attachments are not allowed.');
  }

  const stat = await fs.stat(realPath);
  if (!stat.isFile()) {
    throw attachmentError('Attachment must be a regular file.');
  }
  if (stat.size <= 0) {
    throw attachmentError('Attachment is empty.');
  }
  if (stat.size > PRD_ATTACHMENT_MAX_BYTES) {
    throw attachmentError(`Attachment exceeds the ${PRD_ATTACHMENT_MAX_BYTES / (1024 * 1024)}MB limit.`);
  }

  const bytes = await fs.readFile(realPath);
  const mimeType = detectImageMimeType(bytes);
  if (!mimeType) {
    throw attachmentError('Only PNG, JPEG, GIF, or WebP images are allowed.');
  }

  return {
    name: path.basename(resolvedPath),
    realPath,
    size: stat.size,
    mimeType,
  };
}

async function stagePreparedAttachments(
  session: AttachmentSessionRecord,
  sources: Array<Awaited<ReturnType<typeof validateAndPrepareSource>>>,
): Promise<StagedPrdAttachment[]> {
  await ensureTempDir(session);

  const copied: InternalAttachment[] = [];
  try {
    for (const source of sources) {
      const id = randomUUID();
      const stagedPath = path.join(session.tempDir, `${id}${mimeTypeToExtension(source.mimeType)}`);
      await fs.copyFile(source.realPath, stagedPath);
      copied.push({
        id,
        name: source.name,
        size: source.size,
        mimeType: source.mimeType,
        sourcePath: source.realPath,
        stagedPath,
      });
    }
    session.attachments.push(...copied);
    return session.attachments.map(toPublicAttachment);
  } catch (err) {
    await Promise.all(
      copied.map((attachment) =>
        fs.rm(attachment.stagedPath, { force: true }).catch(() => undefined),
      ),
    );
    throw err;
  }
}

export function createPrdAttachmentSession(opts: {
  senderId: number;
  projectId: string;
}): { attachmentSessionId: string } {
  const attachmentSessionId = randomUUID();
  sessions.set(attachmentSessionId, {
    senderId: opts.senderId,
    projectId: opts.projectId,
    tempDir: path.join(ATTACHMENT_ROOT, attachmentSessionId),
    attachments: [],
  });
  return { attachmentSessionId };
}

export async function stagePrdAttachments(opts: {
  senderId: number;
  projectId: string;
  attachmentSessionId: string;
  paths: string[];
}): Promise<{ attachments: StagedPrdAttachment[] }> {
  if (opts.paths.length === 0) {
    throw attachmentError('No attachments were provided.');
  }

  const session = getSessionOrThrow(opts);
  if (session.attachments.length + opts.paths.length > PRD_ATTACHMENT_MAX_COUNT) {
    throw attachmentError(`You can attach at most ${PRD_ATTACHMENT_MAX_COUNT} images per draft.`);
  }

  const prepared: Array<Awaited<ReturnType<typeof validateAndPrepareSource>>> = [];
  for (const rawPath of opts.paths) {
    prepared.push(await validateAndPrepareSource(rawPath));
  }

  return { attachments: await stagePreparedAttachments(session, prepared) };
}

export async function removePrdAttachment(opts: {
  senderId: number;
  projectId: string;
  attachmentSessionId: string;
  attachmentId: string;
}): Promise<{ attachments: StagedPrdAttachment[] }> {
  const session = getSessionOrThrow(opts);
  const index = session.attachments.findIndex((attachment) => attachment.id === opts.attachmentId);
  if (index === -1) {
    throw attachmentError('Attachment not found.');
  }

  const [removed] = session.attachments.splice(index, 1);
  await fs.rm(removed.stagedPath, { force: true });
  return { attachments: session.attachments.map(toPublicAttachment) };
}

export async function clearPrdAttachmentSession(opts: {
  senderId: number;
  projectId: string;
  attachmentSessionId: string;
}): Promise<void> {
  const session = sessions.get(opts.attachmentSessionId);
  if (!session) return;
  if (session.senderId !== opts.senderId || session.projectId !== opts.projectId) {
    throw attachmentError('Attachment session mismatch.');
  }

  sessions.delete(opts.attachmentSessionId);
  await fs.rm(session.tempDir, { recursive: true, force: true });
}

export function getPrdAttachmentSessionSummary(opts: {
  senderId: number;
  projectId: string;
  attachmentSessionId: string;
}): { attachments: StagedPrdAttachment[] } | null {
  const session = sessions.get(opts.attachmentSessionId);
  if (!session) return null;
  if (session.senderId !== opts.senderId || session.projectId !== opts.projectId) {
    throw attachmentError('Attachment session mismatch.');
  }

  return { attachments: session.attachments.map(toPublicAttachment) };
}
