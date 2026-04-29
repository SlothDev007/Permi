<img width="1753" height="897" alt="image" src="https://github.com/user-attachments/assets/cb2dc549-e525-49cb-9868-ab9d95a0b418" />
# Premi

Premi is a lightweight Manifest V3 Chrome extension that lets you download a Chrome Web Store extension's `manifest.json` without installing the target extension, making it easier to review permissions, metadata, and security details.

## How it works

1. Paste a Chrome Web Store URL or a 32-character Chrome extension ID.
2. Premi requests the CRX from Google's Chrome update endpoint.
3. The CRX is held in memory only, `manifest.json` is extracted from the ZIP payload, and the CRX bytes are discarded.
4. Chrome's downloads API saves the formatted manifest JSON.

Chrome Web Store does not provide a stable public endpoint for only the manifest file, so the CRX must be fetched transiently to read the embedded manifest.

## Load locally

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select this project folder.

## Test

Run the popup core checks with:

```sh
node tests/popup-core.test.mjs
```

## Security notes

- Manifest V3 extension with local scripts only.
- No remote code, inline scripts, `eval`, or third-party runtime dependencies.
- CSP defaults to blocking all loads, then allows only local scripts, local styles, local images, and CRX fetches to Google's update and delivery hosts.
- Narrow permissions: `downloads`, Google's CRX update host, and the observed CRX delivery host. Chrome requires URL match paths in `host_permissions`, but grants host-level access for those entries.
- Extension IDs are validated before network requests.
- Downloaded CRX data and extracted manifests are size-limited and processed in memory only.
- The popup stores no user input, extension IDs, CRX bytes, or extracted manifests.

## Privacy

See [PRIVACY.md](PRIVACY.md).
