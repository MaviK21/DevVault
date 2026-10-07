export const RESOURCE_TYPES = [
  'website',
  'server',
  'ssh',
  'database',
  'api_key',
  'cloudflare',
  'github',
  'docker',
  'deployadmin',
  'note',
] as const;

export type ResourceType = (typeof RESOURCE_TYPES)[number];

export function isResourceType(value: string): value is ResourceType {
  return (RESOURCE_TYPES as readonly string[]).includes(value);
}

export interface Resource {
  id: number;
  projectId: number;
  type: ResourceType;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * A single typed field of a resource.
 * For secret fields `value` holds a base64(nonce | ciphertext | tag) blob,
 * for open fields it holds plaintext.
 */
export interface ResourceField {
  fieldName: string;
  value: string;
  isSecret: boolean;
}
