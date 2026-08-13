const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const http = require('node:http');

const app = require('./server');

async function request(server, path, headers = {}) {
  const { port } = server.address();
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path, method: 'GET', headers },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          resolve({ headers: res.headers, body: Buffer.concat(chunks) });
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

test('server.js', async (t) => {
  const server = app.listen(0);
  t.after(() => server.close());

  await t.test('/resource/:id/compressed with no Accept-Encoding sends identity and a strong ETag', async () => {
    const res = await request(server, '/resource/1/compressed');

    assert.equal(res.headers['content-encoding'], undefined);
    assert.equal(res.headers.etag, '"resource-1-v1"');
    const parsed = JSON.parse(res.body.toString('utf8'));
    assert.equal(parsed.id, '1');
  });

  await t.test('/resource/:id/compressed with Accept-Encoding: gzip sends a gzip body and a strong ETag', async () => {
    const res = await request(server, '/resource/1/compressed', {
      'Accept-Encoding': 'gzip',
    });

    assert.equal(res.headers['content-encoding'], 'gzip');
    assert.equal(res.headers.etag, '"resource-1-v1"');

    const decompressed = zlib.gunzipSync(res.body);
    const parsed = JSON.parse(decompressed.toString('utf8'));
    assert.equal(parsed.id, '1');
  });

  await t.test('/resource/:id/compressed with Accept-Encoding: br sends a brotli body and a strong ETag', async () => {
    const res = await request(server, '/resource/1/compressed', {
      'Accept-Encoding': 'br',
    });

    assert.equal(res.headers['content-encoding'], 'br');
    assert.equal(res.headers.etag, '"resource-1-v1"');

    const decompressed = zlib.brotliDecompressSync(res.body);
    const parsed = JSON.parse(decompressed.toString('utf8'));
    assert.equal(parsed.id, '1');
  });

  await t.test('/resource/:id/compressed with Accept-Encoding: gzip, br prefers br and keeps a strong ETag', async () => {
    const res = await request(server, '/resource/1/compressed', {
      'Accept-Encoding': 'gzip, br',
    });

    assert.equal(res.headers['content-encoding'], 'br');
    assert.equal(res.headers.etag, '"resource-1-v1"');
  });

  await t.test('/resource/:id/compressed ETag is identical whether or not the body was compressed', async () => {
    const [plain, gzipped, brotlied] = await Promise.all([
      request(server, '/resource/1/compressed'),
      request(server, '/resource/1/compressed', { 'Accept-Encoding': 'gzip' }),
      request(server, '/resource/1/compressed', { 'Accept-Encoding': 'br' }),
    ]);

    assert.equal(plain.headers.etag, '"resource-1-v1"');
    assert.equal(gzipped.headers.etag, '"resource-1-v1"');
    assert.equal(brotlied.headers.etag, '"resource-1-v1"');
  });

  await t.test('/resource/:id/compressed?notransform=1 sets no-transform Cache-Control alongside compression', async () => {
    const res = await request(server, '/resource/1/compressed?notransform=1', {
      'Accept-Encoding': 'gzip',
    });

    assert.equal(res.headers['content-encoding'], 'gzip');
    assert.equal(res.headers['cache-control'], 'private, max-age=0, no-transform');
    assert.equal(res.headers.etag, '"resource-1-v1"');
  });

  await t.test('/resource/:id (uncompressed edge-test endpoint) never sets Content-Encoding itself', async () => {
    const res = await request(server, '/resource/1', { 'Accept-Encoding': 'gzip, br' });

    assert.equal(res.headers['content-encoding'], undefined);
    assert.equal(res.headers.etag, '"resource-1-v1"');
  });

  await t.test('/health returns 200', async () => {
    const res = await request(server, '/health');
    assert.equal(res.body.toString('utf8'), 'OK');
  });
});
