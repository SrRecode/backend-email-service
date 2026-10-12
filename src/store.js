import { randomUUID } from 'node:crypto';

const EXCERPT_LENGTH = 120;

export function createStore() {
  const messages = new Map();

  function excerpt(text) {
    const flat = String(text ?? '').replace(/\s+/g, ' ').trim();
    return flat.length <= EXCERPT_LENGTH ? flat : `${flat.slice(0, EXCERPT_LENGTH - 1)}…`;
  }

  return {
    create({ to, subject, text, html }) {
      const message = {
        id: randomUUID(),
        to,
        subject,
        text: text ?? '',
        html: html ?? '',
        status: 'queued',
        attempts: 0,
        error: null,
        messageId: null,
        createdAt: new Date().toISOString(),
        sentAt: null,
      };
      messages.set(message.id, message);
      return message;
    },

    get(id) {
      return messages.get(id) ?? null;
    },

    markSent(id, { messageId }) {
      const message = messages.get(id);
      if (!message) return null;
      message.status = 'sent';
      message.attempts += 1;
      message.messageId = messageId;
      message.error = null;
      message.sentAt = new Date().toISOString();
      return message;
    },

    markFailed(id, error) {
      const message = messages.get(id);
      if (!message) return null;
      message.status = 'failed';
      message.attempts += 1;
      message.error = error instanceof Error ? error.message : String(error);
      return message;
    },

    remove(id) {
      return messages.delete(id);
    },

    /** List summaries (no body), filtered by status and search text. */
    list(filters = {}) {
      let result = [...messages.values()];
      if (filters.status !== undefined) {
        result = result.filter((message) => message.status === filters.status);
      }
      if (typeof filters.q === 'string' && filters.q.trim() !== '') {
        const needle = filters.q.trim().toLowerCase();
        result = result.filter(
          (message) =>
            message.to.toLowerCase().includes(needle) || message.subject.toLowerCase().includes(needle),
        );
      }
      return result
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map(({ text, html, ...rest }) => ({ ...rest, preview: excerpt(text) }));
    },

    stats() {
      const by = { queued: 0, sent: 0, failed: 0 };
      for (const message of messages.values()) by[message.status] += 1;
      return { total: messages.size, ...by };
    },
  };
}
