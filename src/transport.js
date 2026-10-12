import { randomUUID } from 'node:crypto';

/**
 * A pluggable transport. The default one is in-memory: it "delivers" by
 * recording the message and returning an id. Addresses at `fail.test` throw,
 * which lets callers exercise the retry path without a network.
 */
export function createMemoryTransport() {
  return {
    name: 'memory',
    async send(message) {
      if (typeof message.to === 'string' && message.to.endsWith('@fail.test')) {
        throw new Error('Simulated transport failure');
      }
      return { messageId: `mem_${randomUUID()}` };
    },
  };
}
