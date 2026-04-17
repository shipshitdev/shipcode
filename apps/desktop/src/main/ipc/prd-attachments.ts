/**
 * PRD attachment session management.
 *
 * Each CreateIssueModal instance creates a session here. Files are validated
 * (symlink check, magic byte detection) and copied into an isolated temp dir.
 * The session is cleared on submit or modal close.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { StagedPrdAttachment } from '@shipcode/shared';

export const PRD_ATTACHMENT_MAX_COUNT = 6;
export const PRD_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024; // 10 MB

// ---------------------------------------------------------------------------
// Magic byte detection
// ---------------------------------------------------------------------------

type ImageMimeType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';

interface MagicSpec {
  mime: ImageMimeType;
  offset: number;
  bytes: number[];
}

const MAGIC_SPECS: MagicSpec[] = [
  { mime: 'image/png', offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mime: 'image/jpeg', offset: 0, bytes: [0xff, 0xd8, 0xff] },
  { mime: 'image/gif', offset: 0, bytes: [0x47, 0x49, 0x46, 0x38] }, // GIF8
  { mime: 'image/webp', offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] }, // RIFF????WEBP
];

function detectImageMime(buf: Buffer): ImageMimeType | null {
  for (const spec of MAGIC_SPECS) {
    const slice = buf.subarray(spec.offset, spec.offset + spec.bytes.length);
    if (slice.length === spec.bytes.length && spec.bytes.every((b, i) => slice[i] === b)) {
      return spec.mime;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Path normalisation
// ---------------------------------------------------------------------------

/**
 * Strip macOS /private prefix so paths from the drag-and-drop event
 * (which report /private/var/folders/…) match the real FS path.
 */
function normalisePath(p: string): string {
  if (process.platform === 'darwin' && p.startsWith('/private/')) {
    return p.slice('/private'.length);
  }
  return p;
}

// ---------------------------------------------------------------------------
// Session store
// ---------------------------------------------------------------------------

interface AttachmentSession {
  senderId: string;
  projectId: string;
  tmpDir: string;
  attachments: StagedPrdAttachment[];
}

const sessions = new Map<string, AttachmentSession>();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function createPrdAttachmentSession(senderId: string, projectId: string): string {
  const sessionId = crypto.randomUUID();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `shipcode-prd-${sessionId.slice(0, 8)}-`));
  sessions.set(sessionId, { senderId, projectId, tmpDir, attachments: [] });
  return sessionId;
}

export interface StageResult {
  staged: StagedPrdAttachment[];
  errors: string[];
}

export function stagePrdAttachments(sessionId: string, filePaths: string[]): StageResult {
  const session = sessions.get(sessionId);
  if (!session) throw new Error(`No attachment session: ${sessionId}`);

  const staged: StagedPrdAttachment[] = [];
  const errors: string[] = [];

  for (const rawPath of filePaths) {
    const filePath = normalisePath(rawPath);

    // Guard: reject symlinks
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(filePath);
    } catch {
      errors.push(`Cannot stat ${path.basename(filePath)}: file not found`);
      continue;
    }

    if (stat.isSymbolicLink()) {
      errors.push(`${path.basename(filePath)}: symlinks are not allowed`);
      continue;
    }

    if (stat.isDirectory()) {
      errors.push(`${path.basename(filePath)}: directories are not allowed`);
      continue;
    }

    // Size check
    if (stat.size > PRD_ATTACHMENT_MAX_BYTES) {
      errors.push(
        `${path.basename(filePath)}: exceeds ${PRD_ATTACHMENT_MAX_BYTES / 1024 / 1024} MB limit`,
      );
      continue;
    }

    // Total count check
    if (session.attachments.length + staged.length >= PRD_ATTACHMENT_MAX_COUNT) {
      errors.push(`Attachment limit (${PRD_ATTACHMENT_MAX_COUNT}) reached`);
      break;
    }

    // Magic byte validation
    const HEADER_BYTES = 12;
    let header: Buffer;
    try {
      const fd = fs.openSync(filePath, 'r');
      header = Buffer.alloc(HEADER_BYTES);
      fs.readSync(fd, header, 0, HEADER_BYTES, 0);
      fs.closeSync(fd);
    } catch {
      errors.push(`${path.basename(filePath)}: cannot read file`);
      continue;
    }

    const mimeType = detectImageMime(header);
    if (!mimeType) {
      errors.push(`${path.basename(filePath)}: unsupported file type (PNG, JPEG, GIF, WebP only)`);
      continue;
    }

    // Deduplicate by normalised path
    const alreadyStaged = session.attachments.some((a) => a.originalPath === filePath);
    if (alreadyStaged) {
      errors.push(`${path.basename(filePath)}: already attached`);
      continue;
    }

    // Copy to temp dir with a unique name to avoid collisions
    const uniqueName = `${crypto.randomUUID().slice(0, 8)}-${path.basename(filePath)}`;
    const stagedPath = path.join(session.tmpDir, uniqueName);
    try {
      fs.copyFileSync(filePath, stagedPath);
    } catch {
      errors.push(`${path.basename(filePath)}: failed to stage file`);
      continue;
    }

    const attachment: StagedPrdAttachment = {
      originalPath: filePath,
      stagedPath,
      fileName: path.basename(filePath),
      mimeType,
      sizeBytes: stat.size,
    };
    staged.push(attachment);
  }

  session.attachments.push(...staged);
  return { staged, errors };
}

export function removePrdAttachment(sessionId: string, filePath: string): void {
  const session = sessions.get(sessionId);
  if (!session) throw new Error(`No attachment session: ${sessionId}`);

  const normalised = normalisePath(filePath);
  const idx = session.attachments.findIndex(
    (a) => a.originalPath === normalised || a.stagedPath === normalised,
  );
  if (idx === -1) return;

  const [removed] = session.attachments.splice(idx, 1);
  try {
    fs.unlinkSync(removed.stagedPath);
  } catch {
    // best-effort cleanup
  }
}

export function clearPrdAttachmentSession(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (!session) return;

  sessions.delete(sessionId);

  try {
    fs.rmSync(session.tmpDir, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
}

export function getPrdAttachmentSessionSummary(
  sessionId: string,
): { attachments: StagedPrdAttachment[] } | null {
  const session = sessions.get(sessionId);
  if (!session) return null;
  return { attachments: [...session.attachments] };
}
