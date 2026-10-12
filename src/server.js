import { createServer } from './app.js';

const port = Number(process.env.PORT ?? 3000);

const server = createServer();

server.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Email service listening on http://localhost:${port} (in-memory transport)`);
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
