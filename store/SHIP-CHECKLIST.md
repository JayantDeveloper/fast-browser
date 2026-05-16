# fast-browser — Ship Checklist

End-to-end from `pnpm build` to a public Chrome Web Store listing.

## Once, before the first submission

- [ ] Create / log into a Chrome Web Store developer account
      (https://chrome.google.com/webstore/devconsole/) — one-time $5 fee.
- [ ] Pick a hosting URL for `store/privacy-policy.md` (GitHub Pages is
      fine — `https://<user>.github.io/fast-browser/privacy.html`).
- [ ] Generate the four screenshots described in
      `store/listing-copy.md` → "Promotional images" by loading the
      unpacked extension and screenshotting at 1280×800.

## Every submission

### Build

```bash
cd packages/extension
pnpm install                       # only when deps changed
pnpm test                          # all green
pnpm build                         # outputs dist/
```

### Smoke (load unpacked)

- [ ] `chrome://extensions` → Developer mode on → Load unpacked →
      `packages/extension/dist`
- [ ] Toolbar icon shows the gradient bolt (no generic puzzle piece)
- [ ] Click icon → side panel opens
- [ ] Settings → paste API key → save → "Saved." appears
- [ ] Navigate to a real page (e.g. example.com)
- [ ] Type a task ("click the link and tell me what page you land on")
      → Run → watch the trajectory stream → done state shows summary

### Package

```bash
cd packages/extension
zip -r ../../store/fast-browser-0.0.1.zip dist/
```

The zip is the artifact you upload to the Web Store dashboard.

### Submit

- [ ] Upload the zip via the dashboard.
- [ ] Paste copy from `store/listing-copy.md` into the corresponding
      fields (name, short description, detailed description,
      single-purpose statement, permission justifications).
- [ ] Upload the four screenshots and (optionally) the marquee.
- [ ] Paste the privacy-policy URL.
- [ ] Submit for review.

Initial review usually takes 1–3 business days. The `debugger`
permission triggers an additional human review step — Nanobrowser ships
with the same permission, so this is a known acceptable pattern, but
expect questions.

## Versioning

Bump `version` in:

- `packages/extension/manifest.json`
- `packages/extension/package.json`

…in lock-step. The Web Store rejects re-uploads of an existing version.

## Rollback

If a version regresses in the wild, re-publish the previous zip from
`store/` (you keep them all under `store/fast-browser-X.Y.Z.zip`). The
Web Store does not have a one-click rollback.
