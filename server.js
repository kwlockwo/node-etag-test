const zlib = require('node:zlib');
const express = require('express');

const app = express();

// Disable Express's built-in ETag generation so nothing auto-generates or
// touches the ETag header we set manually below.
app.set('etag', false);

// Padding text repeated to push the JSON body comfortably over ~1KB so
// Render's edge (and any intermediate proxy) has enough bytes to consider
// compressing. Bodies under ~1KB are sometimes left uncompressed regardless
// of Accept-Encoding, which would confound this test.
const PADDING_UNIT =
  'The quick brown fox jumps over the lazy dog. Render edge ETag compression test. ';

function buildPadding(repeats) {
  return PADDING_UNIT.repeat(repeats);
}

function buildResourceBody(id, notransform) {
  return {
    id,
    message: `This is resource ${id}`,
    generatedAt: new Date().toISOString(),
    notransform,
    padding: buildPadding(15),
  };
}

app.get('/resource/:id', (req, res) => {
  const { id } = req.params;
  const notransform = req.query.notransform === '1';

  const etag = `"resource-${id}-v1"`;
  const body = buildResourceBody(id, notransform);

  const cacheControl = notransform
    ? 'private, max-age=0, no-transform'
    : undefined;

  res.set('ETag', etag);
  if (cacheControl) {
    res.set('Cache-Control', cacheControl);
  }

  const acceptEncoding = req.headers['accept-encoding'] || '(none)';

  console.log(
    JSON.stringify({
      method: req.method,
      path: req.originalUrl,
      acceptEncoding,
      willSendEtag: etag,
      willSendContentEncoding: '(not set by app)',
      willSendCacheControl: cacheControl || '(not set by app)',
    })
  );

  res.status(200).json(body);
});

// Same resource, but the app itself picks a compression encoding and
// compresses the body before sending it, rather than leaving that to
// Render's/Cloudflare's edge. This exists to test whether keeping the
// entire compression decision in the origin avoids the strong-ETag
// weakening and no-transform inconsistencies observed when the edge
// does the compression instead.
app.get('/resource/:id/compressed', (req, res) => {
  const { id } = req.params;
  const notransform = req.query.notransform === '1';

  const etag = `"resource-${id}-v1"`;
  const body = buildResourceBody(id, notransform);
  const bodyBuffer = Buffer.from(JSON.stringify(body));

  const cacheControl = notransform
    ? 'private, max-age=0, no-transform'
    : undefined;

  const acceptEncoding = req.headers['accept-encoding'] || '';
  let contentEncoding = null;
  let payload = bodyBuffer;

  if (/\bbr\b/.test(acceptEncoding)) {
    contentEncoding = 'br';
    payload = zlib.brotliCompressSync(bodyBuffer);
  } else if (/\bgzip\b/.test(acceptEncoding)) {
    contentEncoding = 'gzip';
    payload = zlib.gzipSync(bodyBuffer);
  }

  res.set('ETag', etag);
  res.set('Content-Type', 'application/json; charset=utf-8');
  if (cacheControl) {
    res.set('Cache-Control', cacheControl);
  }
  if (contentEncoding) {
    res.set('Content-Encoding', contentEncoding);
    res.set('Vary', 'Accept-Encoding');
  }

  console.log(
    JSON.stringify({
      method: req.method,
      path: req.originalUrl,
      acceptEncoding: acceptEncoding || '(none)',
      willSendEtag: etag,
      willSendContentEncoding: contentEncoding || '(not set, origin sent identity)',
      willSendCacheControl: cacheControl || '(not set by app)',
    })
  );

  res.status(200).send(payload);
});

app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`node-etag-test listening on port ${PORT}`);
  });
}

module.exports = app;
