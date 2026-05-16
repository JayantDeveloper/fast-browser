---
date: 2026-05-16
type: bug-pattern
area: llm-providers
keywords: [anthropic, chrome-extension, cors, mv3, service-worker, dangerous-direct-browser-access]
---

# Anthropic API calls from a Chrome extension service worker fail with 401 unless you set `anthropic-dangerous-direct-browser-access: true`

## Symptom

`AnthropicProvider.askJson()` works perfectly from the Node CLI, but
inside the extension's MV3 service worker it returns immediately with:

```
401 Unauthorized
{
  "type": "error",
  "error": {
    "type": "authentication_error",
    "message": "CORS requests must set 'anthropic-dangerous-direct-browser-access' header"
  }
}
```

The error message is *not* about a wrong API key. It's about the request
context.

## Cause

Anthropic blocks direct API calls from any browser-origin context by
default — including extension service workers — to discourage users
from shipping their API key in client-side code where it can be
exfiltrated. The recommended pattern is a server-side proxy that holds
the key.

A Chrome MV3 service worker is a JavaScript module loaded from a
`chrome-extension://` origin. Anthropic's CORS check sees this as a
browser request and rejects it.

## Fix

Add the explicit acknowledgement header to `AnthropicProvider`:

```ts
headers: {
  'x-api-key': this.apiKey,
  'anthropic-version': '2023-06-01',
  'content-type': 'application/json',
  'anthropic-dangerous-direct-browser-access': 'true',
}
```

The `dangerous-direct-browser-access` name is intentional — Anthropic
wants you to confirm you understand the security tradeoff. For BYO-key
extensions like fast-browser, the user's key is in their own browser
and stays there, so the tradeoff is correct: there is no server to put
the key on.

## Why the CLI didn't catch it

The CLI runs in Node, which is *not* a browser context. Node's `fetch`
sends requests without browser-style CORS preflight, and Anthropic
treats Node origins as server-side. The header is only required when
the request fingerprint looks browsery.

## How we caught it

The unit tests mock `fetch`, so they couldn't see this. The first
real-LLM call from the loaded extension via Playwright surfaced it
immediately on step 1 of the W3Schools quiz e2e:

```
quiz e2e result: {
  "success": false,
  "steps": 2,
  "wallMs": 4113,
  "finalResult": "consecutive LLM failures: anthropic 401: ...
                  CORS requests must set 'anthropic-dangerous-direct-browser-access' header"
}
```

## Generalisation

When porting an LLM client between Node and browser contexts, every
provider has its own browser-origin-policy quirks. Audit each before
shipping:

- **Anthropic**: requires `anthropic-dangerous-direct-browser-access: true`
  header.
- **OpenAI**: works from browser by default. Has the same risk profile,
  doesn't gate on it.
- **Gemini**: works from browser by default; the API key is in the URL
  query string (also a key-leak risk pattern).
- **OpenRouter**: works from browser by default; recommends `HTTP-Referer`
  and `X-Title` headers for analytics, not security.

Test the production transport surface for every provider before claiming
"the extension supports X." The unit tests will pass either way.
