import type { ResourceType } from '../types/resource';

export interface RawDetection {
  type: ResourceType;
  confidence: number;
  /** the matched line, trimmed */
  context: string;
  /** resource field values extracted from the line */
  fields: Record<string, string>;
  suggestedName: string;
}

export interface Detector {
  name: string;
  detect(line: string): RawDetection | null;
}

const sshDetector: Detector = {
  name: 'ssh-command',
  detect(line) {
    const match = /\bssh\s+(?:-[^\s]+\s+[^\s]+\s+)*([\w.\-]+)@([\w.\-]+)/.exec(line);
    if (match === null) {
      return null;
    }
    const portMatch = /(?:^|\s)-p\s*(\d+)\b/.exec(line);
    return {
      type: 'ssh',
      confidence: 0.95,
      context: line.trim(),
      fields: {
        username: match[1],
        host: match[2],
        ...(portMatch !== null ? { port: portMatch[1] } : {}),
      },
      suggestedName: `${match[1]}@${match[2]}`,
    };
  },
};

const deployAdminDetector: Detector = {
  name: 'deployadmin-reference',
  detect(line) {
    const match = /\bdeployadmin@([\w.\-]+)/.exec(line);
    if (match === null) {
      return null;
    }
    return {
      type: 'deployadmin',
      confidence: 0.8,
      context: line.trim(),
      fields: { username: 'deployadmin', host: match[1] },
      suggestedName: `deployadmin@${match[1]}`,
    };
  },
};

const databaseUrlDetector: Detector = {
  name: 'database-url',
  detect(line) {
    const match =
      /\b(postgresql|postgres|mysql):\/\/([\w.\-]+):([^@\s]+)@([\w.\-]+)(?::(\d+))?(?:\/([\w.\-]+))?/.exec(
        line,
      );
    if (match === null) {
      return null;
    }
    const scheme = match[1];
    return {
      type: 'database',
      confidence: 0.9,
      context: line.trim(),
      fields: {
        db_type: scheme === 'postgres' ? 'postgresql' : scheme,
        username: match[2],
        password: match[3],
        host: match[4],
        ...(match[5] !== undefined ? { port: match[5] } : {}),
        ...(match[6] !== undefined ? { database_name: match[6] } : {}),
      },
      suggestedName: `${scheme} ${match[4]}`,
    };
  },
};

const githubTokenDetector: Detector = {
  name: 'github-token',
  detect(line) {
    const match = /\b(gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b/.exec(line);
    if (match === null) {
      return null;
    }
    return {
      type: 'api_key',
      confidence: 0.9,
      context: line.trim(),
      fields: { service: 'GitHub', key: match[1] },
      suggestedName: 'GitHub token',
    };
  },
};

/**
 * Cloudflare API tokens are 40 hex characters. A bare 40-hex string is weak
 * evidence, so it only counts when the line also mentions Cloudflare
 * (combined signals, ТЗ §32).
 */
const cloudflareDetector: Detector = {
  name: 'cloudflare-token',
  detect(line) {
    if (!/cloudflare/i.test(line)) {
      return null;
    }
    const match = /\b[a-f0-9]{40}\b/.exec(line);
    if (match === null) {
      return null;
    }
    return {
      type: 'cloudflare',
      confidence: 0.85,
      context: line.trim(),
      fields: { api_token: match[0] },
      suggestedName: 'Cloudflare API token',
    };
  },
};

/**
 * .env style KEY=value lines. A value is treated as a potential secret when
 * the key name hints at a credential and/or the value is long and opaque.
 */
const envVarDetector: Detector = {
  name: 'env-variable',
  detect(line) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(\S.*)$/.exec(line);
    if (match === null) {
      return null;
    }
    const key = match[1];
    const value = match[2].trim().replace(/^["']|["']$/g, '');
    if (value === '') {
      return null;
    }
    if (/^(true|false|null|1|0|yes|no|development|production|test)$/i.test(value)) {
      return null;
    }
    const keyHint = /(PASSWORD|PASSWD|PWD|SECRET|TOKEN|API_?KEY|PRIVATE|CREDENTIAL|AUTH|CERT)/i.test(key);
    const opaqueValue = value.length >= 16 && !/\s/.test(value);
    if (!keyHint && !opaqueValue) {
      return null;
    }
    return {
      type: 'api_key',
      confidence: keyHint && opaqueValue ? 0.85 : 0.55,
      context: line.trim(),
      fields: { service: key, key: value },
      suggestedName: key,
    };
  },
};

/** Order matters: the first matching detector for a line wins. */
export const DETECTORS: readonly Detector[] = [
  sshDetector,
  deployAdminDetector,
  databaseUrlDetector,
  githubTokenDetector,
  cloudflareDetector,
  envVarDetector,
];
