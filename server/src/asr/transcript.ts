import type { Transcript, TranscriptSegment } from './minimax';

/** 单条消息的上限，与 POST /threads/{id}/messages 保持一致。 */
export const MAX_TRANSCRIPT_LENGTH = 20000;

interface SpeakerLine {
  speaker: string;
  parts: string[];
}

/**
 * 把逐句转写合并成「说话人 N：内容」的正文。
 *
 * 只有一个说话人时不加标签：一个人录音的场景里「说话人 1」是噪音。
 */
export function formatTranscript(transcript: Transcript): string {
  const segments = transcript.segments;
  if (segments.length === 0) {
    return truncate(transcript.text.trim());
  }

  const speakerCount = transcript.speakerCount ?? distinctSpeakers(segments);
  const lines = mergeBySpeaker(segments);
  if (speakerCount <= 1) {
    return truncate(lines.map((line) => line.parts.join('')).join('\n'));
  }
  return truncate(lines.map((line) => `说话人 ${speakerLabel(line.speaker)}：${line.parts.join('')}`).join('\n'));
}

function mergeBySpeaker(segments: TranscriptSegment[]): SpeakerLine[] {
  const lines: SpeakerLine[] = [];
  for (const segment of segments) {
    const text = segment.text.trim();
    if (!text) continue;
    const last = lines.at(-1);
    if (last && last.speaker === segment.speaker) {
      last.parts.push(text);
    } else {
      lines.push({ speaker: segment.speaker, parts: [text] });
    }
  }
  return lines;
}

function distinctSpeakers(segments: TranscriptSegment[]): number {
  return new Set(segments.map((segment) => segment.speaker)).size;
}

/** S1 → 1；上游换成别的标识时原样保留，不臆造编号。 */
function speakerLabel(speaker: string): string {
  const match = /^S(\d+)$/.exec(speaker);
  return match ? match[1]! : speaker;
}

function truncate(text: string): string {
  if (text.length <= MAX_TRANSCRIPT_LENGTH) return text;
  return `${text.slice(0, MAX_TRANSCRIPT_LENGTH - 1)}…`;
}
