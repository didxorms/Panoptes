import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assert } from './util.mjs';

export class Vault {
  constructor(directory, encoded = process.env.PANOPTES_MASTER_KEY) {
    mkdirSync(directory, { recursive: true });
    const file = join(directory, 'master.key');
    if (encoded) this.key = Buffer.from(encoded, 'base64');
    else {
      if (!existsSync(file)) writeFileSync(file, randomBytes(32), { mode: 0o600, flag: 'wx' });
      this.key = readFileSync(file);
    }
    assert(this.key.length === 32, 'PANOPTES_MASTER_KEY must encode exactly 32 bytes.');
  }
  seal(secret) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
  }
  open(value) {
    const data = Buffer.from(value, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', this.key, data.subarray(0, 12));
    decipher.setAuthTag(data.subarray(12, 28));
    return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8');
  }
}
