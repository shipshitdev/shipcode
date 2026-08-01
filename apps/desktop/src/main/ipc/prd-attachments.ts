/**
 * PRD attachment session management.
 *
 * Each CreateIssueModal instance creates a session here. Files are validated
 * (symlink check, magic byte detection) and copied into an isolated temp dir.
 * The session is cleared on submit or modal close.
 *
 * Every filesystem call is async: these run in the Electron main process and an
 * attachment can be up to 10 MB, so a synchronous copy would freeze the whole
 * app — renderer IPC, timers, and the pipeline scheduler included — for the
 * duration of the copy.
 */

import crypto from 'node:crypto';
import type { Stats } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { StagedPrdAttachment } from '@shipcode/shared';

const PRD_ATTACHMENT_MAX_COUNT = 6;
const PRD_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024; // 10 MB

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

export async function createPrdAttachmentSession(
  senderId: string,
  projectId: string,
): Promise<string> {
  const sessionId = crypto.randomUUID();
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), `shipcode-prd-${sessionId.slice(0, 8)}-`));
  sessions.set(sessionId, { senderId, projectId, tmpDir, attachments: [] });
  return sessionId;
}

export interface StageResult {
  staged: StagedPrdAttachment[];
  errors: string[];
}

/**
 * Files are staged one at a time on purpose: the per-file decisions are not
 * independent. Each candidate is deduped against everything already staged and
 * counted against PRD_ATTACHMENT_MAX_COUNT, which `break`s the loop mid-list.
 * The cap is 6 files, so serial awaits cost nothing worth the lost determinism.
 */
export async function stagePrdAttachments(
  sessionId: string,
  filePaths: string[],
): Promise<StageResult> {
  const session = sessions.get(sessionId);
  if (!session) throw new Error(`No attachment session: ${sessionId}`);

  const staged: StagedPrdAttachment[] = [];
  const errors: string[] = [];

  for (const rawPath of filePaths) {
    const filePath = normalisePath(rawPath);

    // Guard: reject symlinks
    let stat: Stats;
    try {
      stat = await fs.lstat(filePath);
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
    const header = Buffer.alloc(HEADER_BYTES);
    try {
      const handle = await fs.open(filePath, 'r');
      try {
        await handle.read(header, 0, HEADER_BYTES, 0);
      } finally {
        await handle.close();
      }
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
      await fs.copyFile(filePath, stagedPath);
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

  // The modal can close (and clear the session) while the awaits above are in
  // flight. Its temp dir — and every copy just made into it — is already gone,
  // so report the closure instead of resurrecting a dead session.
  if (!sessions.has(sessionId)) {
    return { staged: [], errors: [...errors, 'Attachment session was closed'] };
  }

  session.attachments.push(...staged);
  return { staged, errors };
}

export async function removePrdAttachment(sessionId: string, filePath: string): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session) throw new Error(`No attachment session: ${sessionId}`);

  const normalised = normalisePath(filePath);
  const idx = session.attachments.findIndex(
    (a) => a.originalPath === normalised || a.stagedPath === normalised,
  );
  if (idx === -1) return;

  // Drop it from the session synchronously so the renderer's next summary is
  // correct even if the unlink below loses its race with a session clear.
  const [removed] = session.attachments.splice(idx, 1);
  try {
    await fs.unlink(removed.stagedPath);
  } catch {
    // best-effort cleanup
  }
}

export async function clearPrdAttachmentSession(sessionId: string): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session) return;

  // Unregister before awaiting: a concurrent stage/remove must see the session
  // as gone rather than write into a temp dir that is being torn down.
  sessions.delete(sessionId);

  try {
    await fs.rm(session.tmpDir, { recursive: true, force: true });
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
