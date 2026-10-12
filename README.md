# Backend Email Service

A transactional email service built on Node's built-in `http` module with
**no runtime dependencies**. It renders templates, stores every message in an
in-memory outbox, and delivers through a **pluggable transport**. The default
transport is in-memory (nothing leaves the process) so it runs and tests
offline — swap in SMTP/API at the edge without touching the service.

## Requirements

- Node.js 18+ (global `fetch`, `crypto.randomUUID`)

## Getting started

```bash
npm start     # http://localhost:3000 (override with PORT)
npm run dev   # start with --watch
npm test      # node:test suite
```

## API

| Method | Path                      | Description                                        |
| ------ | ------------------------- | -------------------------------------------------- |
| GET    | `/health`                 | Transport name plus queued/sent/failed counts      |
| GET    | `/api/templates`          | Available templates and their required variables   |
| GET    | `/api/emails?status=&q=`  | Outbox summaries (no body), newest first           |
| POST   | `/api/emails`             | Queue + attempt delivery (template **or** raw)     |
| GET    | `/api/emails/:id`         | Full message                                       |
| POST   | `/api/emails/:id/retry`   | Re-attempt a **failed** message                    |
| DELETE | `/api/emails/:id`         | Remove a message                                   |

### Send with a template

```bash
curl -s -X POST localhost:3000/api/emails \
  -H 'content-type: application/json' \
  -d '{"to":"ada@example.com","template":"welcome","data":{"name":"Ada","product":"Paper"}}'
```

### Send raw content

```bash
curl -s -X POST localhost:3000/api/emails \
  -H 'content-type: application/json' \
  -d '{"to":"ada@example.com","subject":"Hi","text":"Hello there"}'
```

### Templates

`welcome`, `reset-password`, `receipt` — each declares required variables
(e.g. `reset-password` needs `name`, `code`, `minutes`). Missing variables
return `400`. Variables use `{{name}}` syntax.

### Status codes

- `201` accepted (the response `email.status` is `sent` or `failed`)
- `400` invalid recipient / missing template variables / missing subject+text / bad JSON
- `404` unknown message, `405` wrong method, `409` retry of a non-failed message, `413` body > 32 KB

## Project layout

```
src/templates.js   Templates + {{var}} interpolation (pure, unit tested)
src/transport.js   createMemoryTransport() — the default, offline transport
src/store.js       In-memory outbox: create / markSent / markFailed / list / stats
src/service.js     Orchestrates render -> store -> transport, plus retry
src/app.js         createHandler / createServer — routing and errors
src/server.js      Entry point: listens on PORT and handles shutdown
test/              node:test coverage of templates, store, service and the HTTP API
```

### Design notes

- A **transport** is any object with `name` and `async send(message)` that
  returns `{ messageId }` or throws. `createEmailService({ transport })` injects
  one; tests use a flaky transport to exercise failure + retry without a network.
- The in-memory transport throws for recipients at `fail.test`, so you can
  demo the retry path end to end.
- Delivery is attempted synchronously on `POST`; a message is stored regardless,
  so failures are never lost. `attempts` counts every delivery try.

## Tests

```bash
npm test
```

Covers variable interpolation, template validation, outbox state transitions and
stats, recipient validation, transport success/failure/retry, and HTTP flows
(send via template and raw, filtering, delete, 400/404/405/409).

## License

MIT
