# Voca Bridge API — Integration Guide

External apps (e.g. bilingual-app) consume the **same Voca Bridge** (`voca-local-api.mjs`, port `22053`) as the Voca mobile and web clients.

## Base URL & Auth

```http
Authorization: Bearer <VOCA_API_TOKEN>
```

| Env (server) | Purpose |
|--------------|---------|
| `VOCA_API_TOKEN` | Shared secret for all `/v1/*` routes |
| `VOCA_LLM_API_KEY`, `VOCA_LLM_BASE_URL`, `VOCA_LLM_MODEL` | Card creation (LLM) |
| `VOCA_TTS_API_KEY`, `VOCA_TTS_BASE_URL`, `VOCA_TTS_MODEL` | Audio generation (TTS) |

Create a production token once:

```bash
openssl rand -hex 24 | awk '{print "voca_" $0}'
```

CORS: the bridge **reflects** the request `Origin` header (no domain whitelist). Real security is the Bearer token.

## Endpoints used by external consumers

### Health

```http
GET /v1/health
```

### Lookup word (fast search)

```http
GET /v1/cards/lookup?word=abandon
```

**200 — found:**

```json
{
  "found": true,
  "card": {
    "id": "abandon",
    "word": "abandon",
    "meaningVi": "từ bỏ, bỏ rơi",
    "ipa": "/əˈbændən/",
    "pronunciation": "/əˈbændən/",
    "audioUrl": "/v1/audio/abandon",
    "level": "learning"
  }
}
```

**200 — not found:**

```json
{ "found": false, "word": "abandon" }
```

**400 — missing query:**

```json
{ "error": { "code": "MISSING_WORD", "message": "Missing word query parameter." } }
```

Lookup matches `word`, `slug`, or `id` (case-insensitive).

### List / sync cards

```http
GET /v1/cards
GET /v1/cards?ifChangedSince=<manifestVersion>
GET /v1/sync/bootstrap
```

### Create card

```http
POST /v1/cards/create
Content-Type: application/json

{ "word": "abandon", "settings": { "apiKey": "...", "baseURL": "...", "model": "..." } }
```

Response is **NDJSON stream** (`progress`, `done`, `error`). Proxy consumers should read the stream server-side and return a simple JSON result to their clients.

If LLM env is configured on the bridge, `settings` can be omitted.

### Audio (cache-first)

| Step | Request | Result |
|------|---------|--------|
| 1 | `GET /v1/audio/:id` | `200` MP3 if cached, else `404 AUDIO_NOT_FOUND` |
| 2 | `POST /v1/audio/:id` | Generates TTS for `card.word`, caches MP3, returns JSON `{ audioUrl }` |
| 3 | `GET /v1/audio/:id` | `200` MP3 |

`:id` is the card slug (same as `lookup` response `card.id`).

Optional POST body:

```json
{ "text": "custom phrase", "voiceModel": "edge-tts/en-US-SteffanNeural" }
```

## Smoke test after deploy

```bash
export TOKEN="voca_<your-token>"
export BASE="https://your-voca-api-host"

curl -s -H "Authorization: Bearer $TOKEN" "$BASE/v1/health" | jq .

curl -s -H "Authorization: Bearer $TOKEN" "$BASE/v1/cards/lookup?word=test" | jq .

curl -sI -H "Authorization: Bearer $TOKEN" "$BASE/v1/audio/test"
```

## Error envelope

```json
{
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Missing or invalid Voca API token."
  }
}
```

Common codes: `UNAUTHORIZED`, `NOT_FOUND`, `MISSING_WORD`, `AUDIO_NOT_FOUND`, `LLM_NOT_CONFIGURED`, `TTS_NOT_CONFIGURED`.
