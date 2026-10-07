import type { ResourceType } from '../types/resource';
import { DETECTORS } from './detector';

export const CONFIDENCE_THRESHOLD = 0.4;

export interface Detection {
  type: ResourceType;
  confidence: number;
  source: string;
  context: string;
  fields: Record<string, string>;
  suggestedName: string;
}

/**
 * Runs every line through the detector chain (first match per line wins),
 * deduplicates results and filters out low-confidence noise.
 */
export function classifyText(text: string, source: string): Detection[] {
  const lines = text.split(/\r?\n/);
  const detections: Detection[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    if (line.trim() === '') {
      continue;
    }
    for (const detector of DETECTORS) {
      const raw = detector.detect(line);
      if (raw === null) {
        continue;
      }
      const dedupeKey = `${raw.type}|${raw.suggestedName}|${raw.fields.host ?? ''}|${raw.fields.key ?? ''}`;
      if (!seen.has(dedupeKey)) {
        seen.add(dedupeKey);
        detections.push({ ...raw, source });
      }
      break;
    }
  }
  return detections
    .filter((detection) => detection.confidence >= CONFIDENCE_THRESHOLD)
    .sort((a, b) => b.confidence - a.confidence);
}
