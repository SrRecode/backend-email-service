import { createStore } from './store.js';
import { createMemoryTransport } from './transport.js';
import { renderTemplate } from './templates.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function badRequest(message) {
  return Object.assign(new Error(message), { status: 400 });
}

export function normalizeRecipient(to) {
  if (typeof to !== 'string' || !EMAIL_PATTERN.test(to.trim())) {
    throw badRequest('A valid recipient email is required');
  }
  return to.trim().toLowerCase();
}

/**
 * The email service: turns an API request into a stored message, then attempts
 * delivery through the injected transport. Transports are asynchronous and may
 * fail, so a message can end up `sent` or `failed`.
 */
export function createEmailService({ store = createStore(), transport = createMemoryTransport() } = {}) {
  async function attempt(message) {
    try {
      const result = await transport.send({
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
      return store.markSent(message.id, result ?? {});
    } catch (error) {
      return store.markFailed(message.id, error);
    }
  }

  return {
    /** Accept a message and try to deliver it. Returns the stored record. */
    async send(input = {}) {
      const to = normalizeRecipient(input.to);

      let subject;
      let text;
      let html;
      if (input.template !== undefined) {
        ({ subject, text, html } = renderTemplate(input.template, input.data ?? {}));
      } else {
        if (typeof input.subject !== 'string' || input.subject.trim() === '') {
          throw badRequest('subject is required when no template is given');
        }
        if (typeof input.text !== 'string' || input.text.trim() === '') {
          throw badRequest('text is required when no template is given');
        }
        subject = input.subject.trim();
        text = input.text;
        html = typeof input.html === 'string' ? input.html : '';
      }

      const message = store.create({ to, subject, text, html });
      return attempt(message);
    },

    /** Re-attempt delivery — only for messages that previously failed. */
    async retry(id) {
      const message = store.get(id);
      if (!message) throw Object.assign(new Error('Message not found'), { status: 404 });
      if (message.status !== 'failed') {
        throw Object.assign(new Error('Only failed messages can be retried'), { status: 409 });
      }
      return attempt(message);
    },

    get: (id) => store.get(id),
    list: (filters) => store.list(filters),
    remove: (id) => store.remove(id),
    stats: () => store.stats(),
    transportName: transport.name ?? 'custom',
  };
}
