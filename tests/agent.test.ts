import { describe, expect, it } from 'vitest';
import { classifyText } from '../src/agent/classifier';

describe('credential detectors', () => {
  it('detects an SSH command', () => {
    const [detection] = classifyText('ssh root@185.123.45.67', 'test');
    expect(detection?.type).toBe('ssh');
    expect(detection?.confidence).toBe(0.95);
    expect(detection?.fields.username).toBe('root');
    expect(detection?.fields.host).toBe('185.123.45.67');
    expect(detection?.suggestedName).toBe('root@185.123.45.67');
  });

  it('detects an SSH command with a custom port', () => {
    const [detection] = classifyText('ssh -p 2222 deploy@10.0.0.9', 'test');
    expect(detection?.fields.port).toBe('2222');
    expect(detection?.fields.host).toBe('10.0.0.9');
  });

  it('detects a DeployAdmin reference', () => {
    const [detection] = classifyText('deployadmin@server01', 'test');
    expect(detection?.type).toBe('deployadmin');
    expect(detection?.confidence).toBe(0.8);
    expect(detection?.fields.host).toBe('server01');
  });

  it('detects a PostgreSQL connection string with credentials', () => {
    const [detection] = classifyText(
      'postgres://admin:Sup3rPass@10.0.0.5:5432/shopdb',
      'test',
    );
    expect(detection?.type).toBe('database');
    expect(detection?.confidence).toBe(0.9);
    expect(detection?.fields.db_type).toBe('postgresql');
    expect(detection?.fields.username).toBe('admin');
    expect(detection?.fields.password).toBe('Sup3rPass');
    expect(detection?.fields.host).toBe('10.0.0.5');
    expect(detection?.fields.port).toBe('5432');
    expect(detection?.fields.database_name).toBe('shopdb');
  });

  it('detects a MySQL connection string', () => {
    const [detection] = classifyText('mysql://user:pw@db.example.com/db1', 'test');
    expect(detection?.fields.db_type).toBe('mysql');
  });

  it('detects GitHub tokens', () => {
    const token = 'ghp_' + 'a'.repeat(36);
    const [detection] = classifyText(`GITHUB_TOKEN=${token}`, 'test');
    expect(detection?.type).toBe('api_key');
    expect(detection?.fields.service).toBe('GitHub');
    expect(detection?.fields.key).toBe(token);
  });

  it('detects a Cloudflare token only with a Cloudflare signal (combined evidence)', () => {
    const token = 'a'.repeat(40);
    expect(classifyText(`token ${token}`, 'test')).toHaveLength(0);
    const [detection] = classifyText(`cloudflare api_token: ${token}`, 'test');
    expect(detection?.type).toBe('cloudflare');
    expect(detection?.fields.api_token).toBe(token);
  });

  it('treats .env secrets as candidates with combined-signal confidence', () => {
    const strong = classifyText('DB_PASSWORD=verylongsecretpassword123', 'test');
    expect(strong[0]?.confidence).toBe(0.85);
    const weak = classifyText('FEATURE_FLAG=someLongOpaqueValue123', 'test');
    expect(weak[0]?.confidence).toBe(0.55);
    expect(classifyText('DEBUG=true', 'test')).toHaveLength(0);
    expect(classifyText('APP_NAME=myapp', 'test')).toHaveLength(0);
  });

  it('returns nothing for ordinary text', () => {
    expect(classifyText('just a regular note\nnothing to see here', 'test')).toHaveLength(0);
  });

  it('attaches the source and filters low-confidence detections', () => {
    const detections = classifyText(
      'ssh root@1.2.3.4\nrandom text line\nDB_PASSWORD=longenoughsecretvalue12',
      '.env file test.env',
    );
    expect(detections.every((d) => d.source === '.env file test.env')).toBe(true);
    expect(detections.map((d) => d.type)).toEqual(['ssh', 'api_key']);
  });
});
