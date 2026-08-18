import { createHmac } from 'node:crypto';

const OPAQUE_API_KEY = /^[\x21-\x7e]{8,256}$/;

export function validatePrincipal(principal) {
  if (typeof principal !== 'string' || !OPAQUE_API_KEY.test(principal)) {
    throw new TypeError('x-api-key must be 8-256 visible ASCII characters');
  }
  return principal;
}

export function requirePartitionSecret(secret) {
  if (typeof secret !== 'string' || Buffer.byteLength(secret, 'utf8') < 32) {
    throw new TypeError('PARTITION_HMAC_SECRET must contain at least 32 UTF-8 bytes');
  }
  return secret;
}

export function derivePartitionKey({ policyId, principal, secret }) {
  validatePrincipal(principal);
  requirePartitionSecret(secret);
  return createHmac('sha256', secret)
    .update(policyId)
    .update('\0')
    .update(principal)
    .digest('hex');
}
