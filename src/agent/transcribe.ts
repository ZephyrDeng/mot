/**
 * Speech-to-text for Slack voice/audio attachments via ZenMux.
 *
 * ZenMux `POST /api/v1/audio/transcriptions` takes JSON with the audio inline
 * as base64 (`input_audio.data`) — not OpenAI's multipart upload. Non-streaming
 * returns `{ text, usage }`. Best-effort: returns '' on any failure so a bad
 * transcription never breaks the agent run; the file path is still given to pi.
 */

import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { readEnvValue } from '../config.js';
import { logger } from '../logger.js';
import type { DownloadedFile } from '../session/media.js';

const execFileAsync = promisify(execFile);

const ENDPOINT = 'https://zenmux.ai/api/v1/audio/transcriptions';
/** Xiaomi MiMo-V2.5-ASR: native Chinese–English code-switching, no lang tag needed. */
const MODEL = 'xiaomi/mimo-v2.5-asr';
const TIMEOUT_MS = 30_000;

const FORMATS: Record<string, string> = {
  'audio/x-m4a': 'm4a',
  'audio/m4a': 'm4a',
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/flac': 'flac',
  'audio/ogg': 'ogg',
  'audio/webm': 'webm',
  'audio/aac': 'aac',
};

function isAudio(contentType: string): boolean {
  return contentType.toLowerCase().startsWith('audio/');
}

function toFormat(contentType: string, fileName: string): string {
  const byMime = FORMATS[contentType.toLowerCase().split(';')[0].trim()];
  if (byMime) return byMime;
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  return ['wav', 'mp3', 'flac', 'm4a', 'ogg', 'webm', 'aac'].includes(ext) ? ext : 'm4a';
}

/** ZenMux accepts only wav/mpeg/mp3 — transcode anything else (Slack voice is m4a). */
async function toAcceptedAudio(
  filePath: string,
  format: string,
): Promise<{ data: Buffer; format: string }> {
  if (['wav', 'mp3'].includes(format)) {
    return { data: await readFile(filePath), format };
  }
  try {
    const out = join(tmpdir(), `mot-asr-${process.pid}-${Date.now()}.mp3`);
    await execFileAsync('ffmpeg', [
      '-y',
      '-i',
      filePath,
      '-codec:a',
      'libmp3lame',
      '-q:a',
      '4',
      out,
    ]);
    return { data: await readFile(out), format: 'mp3' };
  } catch (err: any) {
    logger.warn({ err: err.message, filePath }, 'Audio transcode to mp3 failed; sending original');
    return { data: await readFile(filePath), format };
  }
}

/**
 * Transcribe an audio attachment. Returns '' when the file isn't audio, the
 * key is missing, or the call fails — callers then fall back to the path prompt.
 */
export async function transcribeAudio(file: DownloadedFile): Promise<string> {
  if (!isAudio(file.contentType)) return '';
  const apiKey = (readEnvValue('ZENMUX_API_KEY') ?? '').trim();
  if (!apiKey) {
    logger.warn(
      { name: file.originalName },
      'Audio attachment but ZENMUX_API_KEY not set; skipping transcription',
    );
    return '';
  }

  try {
    const audio = await toAcceptedAudio(
      file.filePath,
      toFormat(file.contentType, file.originalName),
    );
    const resp = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        input_audio: {
          data: audio.data.toString('base64'),
          format: audio.format,
        },
        enable_itn: true,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      logger.warn(
        { status: resp.status, body: body.slice(0, 200), name: file.originalName },
        'Transcription request failed',
      );
      return '';
    }

    const json = (await resp.json()) as { text?: string };
    const text = (json.text ?? '').trim();
    logger.info({ name: file.originalName, chars: text.length }, 'Audio transcribed');
    return text;
  } catch (err: any) {
    logger.warn({ name: file.originalName, err: err.message }, 'Audio transcription error');
    return '';
  }
}
