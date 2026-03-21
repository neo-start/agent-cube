import fs from 'fs';
import path from 'path';
import { UPLOADS_DIR } from './config.js';
import type { Attachment } from './types.js';

/**
 * Resolve a /uploads/filename URL to an absolute disk path.
 */
function resolveUploadPath(url: string): string {
  const filename = path.basename(url);
  return path.join(UPLOADS_DIR, filename);
}

/**
 * Middleware: given attachments array, build an enriched prompt suffix.
 *
 * PDFs: include absolute disk path so the agent (Claude Code / Forge) can
 * read them directly using its native Read tool, which handles both text
 * and scanned image PDFs.
 *
 * Other files: include the URL reference as before.
 */
export async function buildAttachmentPrompt(attachments: Attachment[]): Promise<string> {
  if (!attachments || attachments.length === 0) return '';

  const parts: string[] = [];

  for (const att of attachments) {
    const isPdf = att.name.toLowerCase().endsWith('.pdf');
    if (isPdf) {
      const filePath = resolveUploadPath(att.url);
      if (fs.existsSync(filePath)) {
        parts.push(
          `[PDF ATTACHMENT: ${att.name}]\n` +
          `File path: ${filePath}\n` +
          `Read this PDF file to understand its content before proceeding with the task.`
        );
      } else {
        parts.push(`- ${att.name} [PDF, file not found on disk]`);
      }
    } else {
      parts.push(`- ${att.name} [${att.type}]: ${att.url}`);
    }
  }

  return '\n\nATTACHMENTS:\n' + parts.join('\n\n');
}
