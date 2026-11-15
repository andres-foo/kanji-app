# Screenshot import API

`POST /api/import` lets another local app hand KanjiApp a screenshot it has already OCR'd and translated, so nothing is re-processed here. The image and text are stored as-is and the row comes back unfinished (`done = 0`), ready to review and save on `/screenshot`.

The endpoint is off unless the server has `IMPORT_TOKEN` set. It is called server-to-server, so there is no `Origin` header to check — the shared secret is the only gate.

---

## Request

```
POST http://127.0.0.1:3000/api/import
Content-Type: application/json
X-Import-Token: <token>          ← exact value of the server's IMPORT_TOKEN
```

The port is KanjiApp's `PORT` (3000 by default). The app listens on `0.0.0.0`, so a LAN IP also works, but from the same machine use `127.0.0.1`.

```json
{
  "japanese": "猫が窓辺で眠っています。",
  "english": "The cat is sleeping by the window.",
  "image": "<base64 JPEG>",
  "thumb": "<base64 JPEG>",
  "analysis": "## Analysis\n\n- **猫** (neko): cat",
  "position": 0,
  "overwrite": false
}
```

| Field | Type | Required | Rules |
|---|---|---|---|
| `japanese` | string | **yes** | Trimmed by the server; must be non-empty after trim; ≤ 2000 characters |
| `english` | string | no (default `""`) | Trimmed; ≤ 2000 characters |
| `image` | string | **yes** | Standard base64 of JPEG bytes. Decoded size ≤ **15,728,640 bytes** (15 MB). Must be a real JPEG. |
| `thumb` | string | no | Same base64/JPEG rules (practically a ~320 px wide JPEG). **If present it must be valid**, otherwise the whole import fails with `400 invalid thumb`. Omit it (or send `null`) if you have none. |
| `analysis` | string / JSON value | no | Markdown text is stored **verbatim**. If you send an object/array it is stored as JSON text. `null`/absent = none. Stored for later; not rendered in the UI yet. |
| `position` | `0` or `1` | no (default `0`) | Where the text overlay sits on the image: `0` = bottom, `1` = top. Anything else becomes `0`. |
| `overwrite` | boolean | no (default `false`) | Must be JSON `true`, not the string `"true"`. See [Duplicates and overwrite](#duplicates-and-overwrite). |

### Base64 rules (the usual source of failures)

- Use **standard** base64 with padding: `base64.b64encode(data).decode("ascii")`.
- **No** `data:image/jpeg;base64,` prefix. A prefix is rejected as `400 invalid image`.
- Line-wrapped base64 is tolerated (the server strips whitespace), but do not rely on it.
- Empty string, invalid characters or a length that is not a multiple of 4 → `400 invalid image`.
- Send **JPEG** bytes (first bytes `FF D8 FF`). PNG → `415 image must be jpeg`.

### Image sizing (recommended, not enforced beyond the 15 MB cap)

The tool should send the final ready-to-store images so KanjiApp does no re-encoding:

- main image: JPEG, longest side ≤ 1920 px, quality ≈ 0.85–0.90, no EXIF
- thumbnail: JPEG, 320 px wide, quality ≈ 0.76 (matches what KanjiApp's own upload form produces)

Keep the encoding deterministic (fixed quality, no timestamps/EXIF). Idempotency is based on the **exact bytes** of the JPEG: if the same screenshot is re-encoded differently on each run, every run creates a new row.

## Responses

Every response is JSON (except `405`).

| HTTP | Body | Meaning |
|---|---|---|
| 200 | `{"ok":true,"id":N,"duplicate":false}` | New row created |
| 200 | `{"ok":true,"id":N,"duplicate":true}` | These exact image bytes already exist; row `N` is reused |
| 400 | `{"ok":false,"error":"invalid json"}` | Body is not a JSON object (or a non-string `english`) |
| 400 | `{"ok":false,"error":"japanese required"}` | Missing, not a string, or empty after trim |
| 400 | `{"ok":false,"error":"japanese too long"}` | Over 2000 characters |
| 400 | `{"ok":false,"error":"english too long"}` | Over 2000 characters |
| 400 | `{"ok":false,"error":"invalid image"}` | Image missing, not a string, or bad base64 |
| 400 | `{"ok":false,"error":"invalid thumb"}` | `thumb` was sent but is not valid base64 JPEG |
| 401 | `{"ok":false,"error":"bad token"}` | `X-Import-Token` missing or wrong |
| 413 | `{"ok":false,"error":"image too large"}` | Decoded image > 15 MB |
| 415 | `{"ok":false,"error":"image must be jpeg"}` | Decoded bytes are not a JPEG |
| 500 | `{"ok":false,"error":"import failed"}` | File/database write failed on the server |
| 503 | `{"ok":false,"error":"import disabled"}` | KanjiApp has no `IMPORT_TOKEN` set |

A non-POST request returns `405 Method not allowed` as plain text.

**Treat `200` as success even when `duplicate` is `true`** — show "Already in the library (#N)" rather than an error. Do not treat it as a failure and do not retry it.

Validation runs in this order, which decides the error you get: token (`503`/`401`) → JSON (`400`) → `japanese` (`400`) → `english` (`400`) → `image` (`400`/`413`/`415`) → `thumb` (`400`) → storage (`500`).

## Duplicates and overwrite

- Duplicate detection = SHA-256 of the decoded JPEG bytes. Same bytes ⇒ same row id. Text, thumbnail, analysis and timestamps are **not** part of the key.
- `overwrite: false` (default): the existing row is returned untouched, except that a row that is still **unfinished** (`done = 0`) gets missing pieces filled (missing thumbnail, missing analysis, empty japanese/english). Non-empty values are never replaced; saved rows (`done = 1`) are never modified.
- `overwrite: true`: `japanese`, `english`, `analysis` and `position` are replaced on the existing row. The image, row id, creation time, `done` state and "imported" marker are kept. Use this for an explicit "Replace in KanjiApp" action.
- **Retries:** if a request times out or the connection drops, retry the same body — you will get `duplicate:true` with the original id, which means it worked. Do not consider a timeout a failed import until a retry confirms it.
- There is no batch endpoint; send one screenshot per request. Sequential or parallel both work.

## What KanjiApp does with the row

The row is created **unfinished** (`done = 0`) with `japanese` and `english` prefilled, marked "from app", with the import timestamp. It appears at the top of the queue on `http://127.0.0.1:3000/screenshot`, where a human reviews it and presses Save. The returned id is the row id, usable at `/shot/<id>` and in the screenshot page.

Importing must not call `/screenshot/:id/save`, `/screenshot/:id/autofill` or `/api/translate`; those are browser actions. `/api/import` is the only endpoint required.

## Reference implementation (Python)

`pip install requests pillow`

```python
import base64
import io
import requests
from PIL import Image

KANJIAPP_URL = "http://127.0.0.1:3000"
IMPORT_TOKEN = "the-same-token-the-server-was-started-with"


def _jpeg_base64(img: Image.Image, max_width: int, quality: int) -> str:
    img = img.convert("RGB")
    if img.width > max_width:
        height = max(1, round(img.height * max_width / img.width))
        img = img.resize((max_width, height), Image.LANCZOS)
    buf = io.BytesIO()
    # no exif/timestamp: identical input -> identical bytes -> idempotent imports
    img.save(buf, format="JPEG", quality=quality, optimize=True)
    return base64.b64encode(buf.getvalue()).decode("ascii")


def import_screenshot(
    image_path: str,
    japanese: str,
    english: str = "",
    analysis_md: str | None = None,
    position: int = 0,
    overwrite: bool = False,
) -> dict:
    with Image.open(image_path) as img:
        payload = {
            "japanese": japanese.strip()[:2000],
            "english": (english or "").strip()[:2000],
            "image": _jpeg_base64(img, 1920, 88),
            "thumb": _jpeg_base64(img, 320, 76),
            "position": 1 if position == 1 else 0,
            "overwrite": bool(overwrite),
        }
    if analysis_md:
        payload["analysis"] = analysis_md

    resp = requests.post(
        f"{KANJIAPP_URL}/api/import",
        json=payload,                                  # sets Content-Type: application/json
        headers={"X-Import-Token": IMPORT_TOKEN},
        timeout=60,
    )

    try:
        body = resp.json()
    except ValueError:
        raise RuntimeError(f"KanjiApp returned HTTP {resp.status_code}: {resp.text[:200]}")

    if resp.status_code == 200 and body.get("ok"):
        # {"ok": True, "id": 42, "duplicate": False | True}
        return body

    error = body.get("error", body)
    if resp.status_code == 401:
        raise RuntimeError("KanjiApp rejected the token — check IMPORT_TOKEN")
    if resp.status_code == 503:
        raise RuntimeError("Import is disabled on KanjiApp — set IMPORT_TOKEN there and restart it")
    if resp.status_code == 415:
        raise RuntimeError("Image is not a JPEG — convert it to JPEG before sending")
    if resp.status_code == 413:
        raise RuntimeError("Image is larger than 15 MB after base64 decoding")
    raise RuntimeError(f"Import failed ({resp.status_code}): {error}")
```

Usage: `import_screenshot("shot.jpg", "猫が窓辺で眠っています。", "The cat is sleeping by the window.", "## Analysis…")`. Display `body["id"]` and, when `body["duplicate"]` is true, say "already imported as #N".

## Do not

- Don't send PNG, WebP or a `data:` URI.
- Don't re-run OCR/translation, and don't call any endpoint other than `POST /api/import`.
- Don't add an `Origin` header (not needed; the token is the only gate).
- Don't call `/screenshot/:id/save` — the human finishes the row in the UI.
- Don't send more than 2000 characters of Japanese/English; truncate first.
- Don't treat `duplicate:true` as an error.

## Quick self-test

```bash
# 1) works: expect 200 {"ok":true,"id":N,"duplicate":false}
curl -s -X POST http://127.0.0.1:3000/api/import \
  -H "Content-Type: application/json" -H "X-Import-Token: <token>" \
  --data-binary @payload.json

# 2) same body again: expect 200 with the same id and "duplicate":true
# 3) wrong token: expect 401 {"ok":false,"error":"bad token"}
# 4) a PNG payload: expect 415 {"ok":false,"error":"image must be jpeg"}
```

Then open `http://127.0.0.1:3000/screenshot`: the newest unfinished row should be at the top, prefilled, with a "From app" badge.
