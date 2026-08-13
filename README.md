# node-etag-test

Minimal Express app for testing how a hosting platform's public edge/CDN
handles a **strong ETag** under different `Accept-Encoding` /
`Cache-Control` combinations. The app sets the ETag manually and does no
compression itself — any gzip/br you see in the response was added by the
platform's edge/proxy layer, not this code.

## Endpoints

- `GET /resource/:id` — returns a ~1.2KB JSON body with `ETag:
  "resource-<id>-v1"` (strong, no `W/` prefix). Add `?notransform=1` to also
  send `Cache-Control: private, max-age=0, no-transform`. Logs method, path,
  `Accept-Encoding`, and the ETag/Content-Encoding/Cache-Control it's about
  to send, to stdout. Never sets `Content-Encoding` itself — any
  compression you see on this endpoint was added by the edge/proxy layer.
- `GET /resource/:id/compressed` — same resource and same strong ETag, but
  the app itself compresses the body (gzip or brotli, based on the
  request's `Accept-Encoding`) and sets `Content-Encoding` before sending
  it, instead of relying on the edge to compress it. Use this to check
  whether an edge that weakens ETags or mishandles `no-transform` when *it*
  compresses the response leaves things alone when the origin already did
  the compression itself.
- `GET /health` — returns `200 OK`, for use as a platform health check.

## Local tests

`npm test` runs a small `node:test` suite (`server.test.js`) against the app
in-process — no live deploy needed. It asserts that `/resource/:id/compressed`
always returns the strong `"resource-<id>-v1"` ETag unchanged regardless of
whether the body ended up gzip, brotli, or uncompressed, and that
`/resource/:id` never sets `Content-Encoding` on its own.

## Deploy

1. Push this directory to a new Git repo.
2. Deploy it to your hosting platform of choice as a Node web service, with
   the start command `npm start` and health check path `/health`. (If your
   platform supports a `render.yaml`-style manifest file, adapt the included
   `render.yaml` accordingly, or just configure the service by hand.)
3. Once live, note your service's public URL.

## Test curls — `/resource/:id` (edge-compressed)

Replace `<HOST>` with your live public URL. For each response, grep for:
`etag`, `content-encoding`, `cache-control`, `vary`, and any
platform-specific trace/request-ID header (e.g. something like
`x-request-id`, `cf-ray`, or a platform-branded equivalent) so you can
cross-reference with the platform's logs.

### Without `?notransform=1`

| # | Scenario | Command |
|---|----------|---------|
| a | No `Accept-Encoding` header | `curl -sD - "https://<HOST>/resource/1" -o /dev/null \| grep -iE 'etag\|content-encoding\|cache-control\|vary\|request-id\|ray'` |
| b | `Accept-Encoding: identity` | `curl -sD - -H "Accept-Encoding: identity" "https://<HOST>/resource/1" -o /dev/null \| grep -iE 'etag\|content-encoding\|cache-control\|vary\|request-id\|ray'` |
| c | `Accept-Encoding: gzip` | `curl -sD - -H "Accept-Encoding: gzip" "https://<HOST>/resource/1" -o /dev/null \| grep -iE 'etag\|content-encoding\|cache-control\|vary\|request-id\|ray'` |
| d | `Accept-Encoding: br` | `curl -sD - -H "Accept-Encoding: br" "https://<HOST>/resource/1" -o /dev/null \| grep -iE 'etag\|content-encoding\|cache-control\|vary\|request-id\|ray'` |
| e | `Accept-Encoding: gzip, br` | `curl -sD - -H "Accept-Encoding: gzip, br" "https://<HOST>/resource/1" -o /dev/null \| grep -iE 'etag\|content-encoding\|cache-control\|vary\|request-id\|ray'` |

### With `?notransform=1`

| # | Scenario | Command |
|---|----------|---------|
| f | No `Accept-Encoding` header | `curl -sD - "https://<HOST>/resource/1?notransform=1" -o /dev/null \| grep -iE 'etag\|content-encoding\|cache-control\|vary\|request-id\|ray'` |
| g | `Accept-Encoding: identity` | `curl -sD - -H "Accept-Encoding: identity" "https://<HOST>/resource/1?notransform=1" -o /dev/null \| grep -iE 'etag\|content-encoding\|cache-control\|vary\|request-id\|ray'` |
| h | `Accept-Encoding: gzip` | `curl -sD - -H "Accept-Encoding: gzip" "https://<HOST>/resource/1?notransform=1" -o /dev/null \| grep -iE 'etag\|content-encoding\|cache-control\|vary\|request-id\|ray'` |
| i | `Accept-Encoding: br` | `curl -sD - -H "Accept-Encoding: br" "https://<HOST>/resource/1?notransform=1" -o /dev/null \| grep -iE 'etag\|content-encoding\|cache-control\|vary\|request-id\|ray'` |
| j | `Accept-Encoding: gzip, br` | `curl -sD - -H "Accept-Encoding: gzip, br" "https://<HOST>/resource/1?notransform=1" -o /dev/null \| grep -iE 'etag\|content-encoding\|cache-control\|vary\|request-id\|ray'` |

> Tip: if `grep` finds nothing for a header on a given run, that itself is a
> result worth recording (e.g. "no `Vary` header sent").

## Results — `/resource/:id` (edge-compressed)

| Encoding requested | notransform | ETag returned | Content-Encoding returned |
|---------------------|-------------|----------------|-----------------------------|
| (none) | off | `W/"resource-1-v1"` | (none) |
| identity | off | `W/"resource-1-v1"` | (none) |
| gzip | off | `W/"resource-1-v1"` | gzip |
| br | off | `"resource-1-v1"` | br |
| gzip, br | off | `"resource-1-v1"` | br |
| (none) | on | `W/"resource-1-v1"` | (none) |
| identity | on | `W/"resource-1-v1"` | (none) |
| gzip | on | `W/"resource-1-v1"` | (none) |
| br | on | `"resource-1-v1"` | br |
| gzip, br | on | `"resource-1-v1"` | br |

## Test curls — `/resource/:id/compressed` (origin-compressed)

Same matrix, against `/resource/1/compressed` instead. If the edge leaves an
already-compressed origin response alone, ETag should stay
`"resource-1-v1"` (strong) in every row here — that's the behavior these
curls are checking for.

| # | Scenario | Command |
|---|----------|---------|
| a | No `Accept-Encoding` header | `curl -sD - "https://<HOST>/resource/1/compressed" -o /dev/null \| grep -iE 'etag\|content-encoding\|cache-control\|vary\|request-id\|ray'` |
| b | `Accept-Encoding: identity` | `curl -sD - -H "Accept-Encoding: identity" "https://<HOST>/resource/1/compressed" -o /dev/null \| grep -iE 'etag\|content-encoding\|cache-control\|vary\|request-id\|ray'` |
| c | `Accept-Encoding: gzip` | `curl -sD - -H "Accept-Encoding: gzip" "https://<HOST>/resource/1/compressed" -o /dev/null \| grep -iE 'etag\|content-encoding\|cache-control\|vary\|request-id\|ray'` |
| d | `Accept-Encoding: br` | `curl -sD - -H "Accept-Encoding: br" "https://<HOST>/resource/1/compressed" -o /dev/null \| grep -iE 'etag\|content-encoding\|cache-control\|vary\|request-id\|ray'` |
| e | `Accept-Encoding: gzip, br` | `curl -sD - -H "Accept-Encoding: gzip, br" "https://<HOST>/resource/1/compressed" -o /dev/null \| grep -iE 'etag\|content-encoding\|cache-control\|vary\|request-id\|ray'` |
| f | No `Accept-Encoding`, `?notransform=1` | `curl -sD - "https://<HOST>/resource/1/compressed?notransform=1" -o /dev/null \| grep -iE 'etag\|content-encoding\|cache-control\|vary\|request-id\|ray'` |
| g | `Accept-Encoding: gzip`, `?notransform=1` | `curl -sD - -H "Accept-Encoding: gzip" "https://<HOST>/resource/1/compressed?notransform=1" -o /dev/null \| grep -iE 'etag\|content-encoding\|cache-control\|vary\|request-id\|ray'` |
| h | `Accept-Encoding: br`, `?notransform=1` | `curl -sD - -H "Accept-Encoding: br" "https://<HOST>/resource/1/compressed?notransform=1" -o /dev/null \| grep -iE 'etag\|content-encoding\|cache-control\|vary\|request-id\|ray'` |

## Results — `/resource/:id/compressed` (origin-compressed)

| Encoding requested | notransform | ETag returned | Content-Encoding returned |
|---------------------|-------------|----------------|-----------------------------|
| (none) | off | `W/"resource-1-v1"` | (none) |
| identity | off | `W/"resource-1-v1"` | (none) |
| gzip | off | `W/"resource-1-v1"` | gzip |
| br | off | `"resource-1-v1"` | br |
| gzip, br | off | `"resource-1-v1"` | br |
| (none) | on | `W/"resource-1-v1"` | (none) |
| gzip | on | `W/"resource-1-v1"` | gzip |
| br | on | `"resource-1-v1"` | br |

## Findings

Tested against a live `.onrender.com` deployment (Cloudflare-fronted) and,
separately, directly against the origin container on `localhost`, bypassing
Cloudflare and Render's edge/proxy entirely.

**Baseline (localhost, no edge in the path):** the app's strong ETag
(`"resource-1-v1"`) comes back completely unchanged in every single
combination — every `Accept-Encoding` value, both endpoints, `notransform`
on or off. No exceptions. This confirms the app itself, and Render's own Go
proxy (`renderinc/api/pkg/proxy`, checked directly — it has no code path
that reads or rewrites the `ETag` response header for dynamic services),
are not responsible for anything that follows.

**Through Cloudflare:** the strong ETag survives untouched **only** when
the response's `Content-Encoding` ends up being `br` (brotli). For every
other case — no `Content-Encoding` at all, or `Content-Encoding: gzip` — the
ETag is rewritten to weak (`W/"resource-1-v1"`), even though the resource,
and its bytes, are otherwise identical.

Critically, this holds regardless of *who* produced the encoding:
`/resource/:id/compressed` has the origin do its own gzip/brotli compression
and set `Content-Encoding` itself, with Cloudflare never touching the body —
and the exact same asymmetry appears anyway. That rules out "Cloudflare
weakens the ETag because it transcoded the response" as the explanation;
Cloudflare didn't transcode anything in that case. The weakening appears to
be a policy keyed directly on the outgoing `Content-Encoding` header value
(gzip/absent → weaken, br → leave alone), not on whether Cloudflare itself
performed any transformation.

Practical implications:
- There is no origin-side workaround. Self-compression does not avoid the
  weakening, since Cloudflare applies the same rule to already-compressed
  origin responses.
- `Cache-Control: no-transform` is honored for gzip (compression is
  suppressed) but has no effect at all on brotli — br is served regardless
  of `no-transform` being present, on both endpoints.
- No Cloudflare dashboard setting for this was found — the standalone
  Brotli toggle under Speed → Content Optimization no longer exists in this
  zone, consistent with brotli now being applied automatically. This looks
  like it needs to be raised with Cloudflare directly (with the `cf-ray` IDs
  from these runs as reproduction evidence), since there's no proxy code or
  customer-facing zone setting on Render's side that's responsible.
