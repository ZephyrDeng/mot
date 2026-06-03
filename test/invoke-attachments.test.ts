import { describe, expect, it } from 'vitest';
import { buildAttachmentPathPrompt } from '../src/agent/invoke.js';
import type { DownloadedFile } from '../src/session/media.js';

describe('buildAttachmentPathPrompt', () => {
  it('passes attachments by local path rather than inline @file content', () => {
    const files: DownloadedFile[] = [
      {
        filePath: '/tmp/session/media/report.docx',
        originalName: 'report.docx',
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        size: 12345,
      },
      {
        filePath: '/tmp/session/media/model.xlsx',
        originalName: 'model.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        size: 67890,
      },
    ];

    const prompt = buildAttachmentPathPrompt(files);

    expect(prompt).toContain('<attachments>');
    expect(prompt).toContain('path: /tmp/session/media/report.docx');
    expect(prompt).toContain(
      'type: application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    expect(prompt).toContain('size: 67890 bytes');
    expect(prompt).toContain('Use tools to inspect or convert these paths');
    expect(prompt).not.toContain('@/tmp/session/media/report.docx');
  });
});
