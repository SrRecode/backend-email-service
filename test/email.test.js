import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/app.js';
import { createEmailService, normalizeRecipient } from '../src/service.js';
import { createStore } from '../src/store.js';
import { createMemoryTransport } from '../src/transport.js';
import { listTemplates, renderTemplate, interpolate } from '../src/templates.js';

let server;
let base;

before(async () => {
  server = createServer();
  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

const api = (path, init) => fetch(`${base}${path}`, init);
const post = (path, body) =>
  api(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('templates', () => {
  test('interpolate replaces and blanks out known/unknown variables', () => {
    assert.equal(interpolate('Hi {{name}}!', { name: 'Ada' }), 'Hi Ada!');
    assert.equal(interpolate('Hi {{ name }}', { name: 'Ada' }), 'Hi Ada');
    assert.equal(interpolate('Hi {{missing}}', {}), 'Hi ');
  });

  test('renderTemplate fills a known template', () => {
    const rendered = renderTemplate('reset-password', { name: 'Ada', code: '123456', minutes: 15 });
    assert.equal(rendered.subject, 'Reset your password');
    assert.match(rendered.text, /123456/);
    assert.match(rendered.html, /123456/);
  });

  test('renderTemplate rejects unknown templates and missing variables', () => {
    assert.throws(() => renderTemplate('nope', {}), /Unknown template/);
    assert.throws(() => renderTemplate('welcome', { name: 'Ada' }), /Missing template variables: product/);
  });

  test('listTemplates exposes ids and required variables', () => {
    const ids = listTemplates().map((t) => t.id);
    assert.ok(ids.includes('welcome'));
    assert.ok(ids.includes('receipt'));
  });
});

describe('store', () => {
  test('creates, marks sent/failed and reports stats', () => {
    const store = createStore();
    const m = store.create({ to: 'a@b.com', subject: 's', text: 'hello' });
    assert.equal(m.status, 'queued');
    store.markSent(m.id, { messageId: 'x' });
    assert.equal(store.get(m.id).status, 'sent');
    assert.equal(store.get(m.id).attempts, 1);

    const f = store.create({ to: 'c@d.com', subject: 's', text: 't' });
    store.markFailed(f.id, new Error('boom'));
    assert.equal(store.get(f.id).error, 'boom');

    assert.deepEqual(store.stats(), { total: 2, queued: 0, sent: 1, failed: 1 });
  });

  test('list summarizes (excerpt, no body) and filters by status and query', () => {
    const store = createStore();
    store.create({ to: 'keep@x.com', subject: 'Hello', text: 'a'.repeat(200) });
    store.create({ to: 'other@y.com', subject: 'Bye', text: 'short' });

    const all = store.list();
    assert.equal(all.length, 2);
    assert.equal(all[0].text, undefined, 'body omitted from summaries');
    assert.ok(all[0].preview.length <= 120);

    assert.equal(store.list({ q: 'keep' }).length, 1);
    assert.equal(store.list({ status: 'sent' }).length, 0);
  });
});

describe('service', () => {
  test('normalizes and validates recipients', () => {
    assert.equal(normalizeRecipient('  A@B.COM '), 'a@b.com');
    assert.throws(() => normalizeRecipient('nope'), /valid recipient/);
  });

  test('sends via the transport and records success', async () => {
    const service = createEmailService();
    const message = await service.send({ to: 'ada@example.com', template: 'welcome', data: { name: 'Ada', product: 'Paper' } });
    assert.equal(message.status, 'sent');
    assert.match(message.messageId, /^mem_/);
    assert.match(message.subject, /Ada/);
  });

  test('a failing transport records a failed message that can be retried', async () => {
    let flaky = true;
    const transport = {
      name: 'flaky',
      async send() {
        if (flaky) throw new Error('down');
        return { messageId: 'ok' };
      },
    };
    const service = createEmailService({ transport });

    const failed = await service.send({ to: 'x@example.com', subject: 's', text: 'body' });
    assert.equal(failed.status, 'failed');
    assert.equal(failed.error, 'down');

    flaky = false;
    const retried = await service.retry(failed.id);
    assert.equal(retried.status, 'sent');
    assert.equal(retried.attempts, 2);

    await assert.rejects(() => service.retry(retried.id), /Only failed messages/);
  });
});

describe('HTTP email api', () => {
  test('health reports transport and counts', async () => {
    const body = await (await api('/health')).json();
    assert.equal(body.status, 'ok');
    assert.equal(body.transport, 'memory');
    assert.equal(typeof body.total, 'number');
  });

  test('GET /api/templates lists templates', async () => {
    const body = await (await api('/api/templates')).json();
    assert.ok(body.templates.some((t) => t.id === 'welcome'));
  });

  test('POST /api/emails with a template returns a sent message', async () => {
    const res = await post('/api/emails', {
      to: 'ada@example.com',
      template: 'receipt',
      data: { product: 'Keyboard', total: '$99', orderId: 'A-1' },
    });
    assert.equal(res.status, 201);
    const { email } = await res.json();
    assert.equal(email.status, 'sent');
    assert.match(email.subject, /Keyboard/);
  });

  test('POST /api/emails with raw subject/text works, and validation fails cleanly', async () => {
    const ok = await post('/api/emails', { to: 'a@b.com', subject: 'Hi', text: 'Hello there' });
    assert.equal(ok.status, 201);

    assert.equal((await post('/api/emails', { to: 'bad', subject: 's', text: 't' })).status, 400);
    assert.equal((await post('/api/emails', { to: 'a@b.com', text: 'no subject' })).status, 400);
    assert.equal((await post('/api/emails', {})).status, 400, 'empty body rejected');
  });

  test('failed delivery is persisted and retryable over HTTP', async () => {
    const created = await (
      await post('/api/emails', { to: 'boom@fail.test', subject: 's', text: 't' })
    ).json();
    assert.equal(created.email.status, 'failed');

    const retried = await api(`/api/emails/${created.email.id}/retry`, { method: 'POST' });
    assert.equal(retried.status, 200);
    assert.equal((await retried.json()).email.status, 'failed', 'memory transport always fails this address');
  });

  test('list, get, filter and delete', async () => {
    const created = await (await post('/api/emails', { to: 'list@example.com', subject: 'Find me', text: 'x' })).json();

    const list = await (await api('/api/emails?q=find')).json();
    assert.ok(list.emails.some((e) => e.id === created.email.id));

    const fetched = await api(`/api/emails/${created.email.id}`);
    assert.equal(fetched.status, 200);

    assert.equal((await api(`/api/emails/${created.email.id}`, { method: 'DELETE' })).status, 204);
    assert.equal((await api(`/api/emails/${created.email.id}`)).status, 404);
  });

  test('retry of a sent message returns 409, missing returns 404, bad method 405', async () => {
    const sent = await (await post('/api/emails', { to: 'ok@example.com', subject: 's', text: 't' })).json();
    assert.equal((await api(`/api/emails/${sent.email.id}/retry`, { method: 'POST' })).status, 409);
    assert.equal((await api('/api/emails/does-not-exist/retry', { method: 'POST' })).status, 404);
    assert.equal((await api('/api/emails', { method: 'PUT' })).status, 405);
  });
});
