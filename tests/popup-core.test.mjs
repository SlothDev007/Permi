import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";

import {
  CRX_MAGIC,
  MAX_CRX_BYTES,
  MAX_MANIFEST_BYTES,
  ZIP_CENTRAL_DIRECTORY_SIGNATURE,
  ZIP_EOCD_SIGNATURE,
  ZIP_LOCAL_FILE_SIGNATURE,
  extractManifestJson,
  fetchCrx,
  parseExtensionId
} from "../popup-core.mjs";

function makeZip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const file of files) {
    const name = Buffer.from(file.name);
    const data = file.deflate ? deflateRawSync(file.data) : Buffer.from(file.data);
    const method = file.deflate ? 8 : 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(ZIP_LOCAL_FILE_SIGNATURE, 0);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(file.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    localParts.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(ZIP_CENTRAL_DIRECTORY_SIGNATURE, 0);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(file.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);

    offset += local.length + name.length + data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(ZIP_EOCD_SIGNATURE, 0);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return new Uint8Array(Buffer.concat([...localParts, centralDirectory, eocd]));
}

function makeCrx3(zipBytes) {
  const header = Buffer.alloc(12);
  header.writeUInt32LE(CRX_MAGIC, 0);
  header.writeUInt32LE(3, 4);
  header.writeUInt32LE(0, 8);
  return new Uint8Array(Buffer.concat([header, Buffer.from(zipBytes)]));
}

function getCentralDirectoryOffset(zipBytes) {
  const buffer = Buffer.from(zipBytes);
  return buffer.readUInt32LE(buffer.length - 6);
}

function getCentralDirectorySize(zipBytes) {
  const buffer = Buffer.from(zipBytes);
  return buffer.readUInt32LE(buffer.length - 10);
}

function makeResponseStream(chunks, onCancel = () => {}) {
  let index = 0;

  return new ReadableStream({
    pull(controller) {
      if (index >= chunks.length) {
        controller.close();
        return;
      }

      controller.enqueue(chunks[index]);
      index += 1;
    },
    cancel(reason) {
      onCancel(reason);
    }
  });
}

function makeMockResponseBody(chunks, onCancel = () => {}) {
  let index = 0;

  return {
    getReader() {
      return {
        cancel(reason) {
          onCancel(reason);
          return Promise.resolve();
        },
        read() {
          if (index >= chunks.length) {
            return Promise.resolve({ done: true });
          }

          const value = chunks[index];
          index += 1;
          return Promise.resolve({ done: false, value });
        }
      };
    }
  };
}

async function assertParseExtensionId() {
  const extensionId = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

  assert.equal(parseExtensionId(extensionId), extensionId);
  assert.equal(parseExtensionId(extensionId.toUpperCase()), extensionId);
  assert.equal(
    parseExtensionId(`https://chromewebstore.google.com/detail/example/${extensionId}`),
    extensionId
  );
  assert.equal(
    parseExtensionId(`https://chrome.google.com/webstore/detail/example/${extensionId}`),
    extensionId
  );
  assert.equal(
    parseExtensionId(`https://chromewebstore.google.com/detail/?id=${extensionId}`),
    extensionId
  );
  assert.throws(() => parseExtensionId(`https://microsoftedge.microsoft.com/addons/detail/${extensionId}`));
  assert.throws(() => parseExtensionId(`http://chromewebstore.google.com/detail/example/${extensionId}`));
  assert.throws(() => parseExtensionId("not-a-url"));
  assert.throws(() => parseExtensionId("zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz"));
  assert.throws(() => parseExtensionId(`https://chromewebstore.google.com/${"a".repeat(2050)}`), /shorter/);
}

async function assertFetchCrx() {
  const extensionId = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  let requestedUrl = "";
  let requestedOptions = null;

  const smallBytes = new Uint8Array([1, 2, 3]);
  const smallResponse = new Response(makeResponseStream([smallBytes]), {
    status: 200
  });
  const crxBytes = await fetchCrx(extensionId, {
    fetchImpl(url, options) {
      requestedUrl = url;
      requestedOptions = options;
      return Promise.resolve(smallResponse);
    },
    userAgent: "Chrome/123.0.4567.89"
  });

  assert.deepEqual([...crxBytes], [1, 2, 3]);
  assert.match(requestedUrl, /^https:\/\/clients2\.google\.com\/service\/update2\/crx\?/);
  assert.equal(new URL(requestedUrl).searchParams.get("prodversion"), "123.0.4567.89");
  assert.equal(requestedOptions.credentials, "omit");
  assert.equal(requestedOptions.cache, "no-store");
  assert.equal(requestedOptions.redirect, "follow");

  let aborted = false;
  let canceled = false;
  class MockAbortController {
    signal = {};

    abort() {
      aborted = true;
    }
  }

  const oneMiB = new Uint8Array(1024 * 1024);
  const oversizedChunks = Array.from(
    { length: Math.floor(MAX_CRX_BYTES / oneMiB.byteLength) + 1 },
    () => oneMiB
  );
  const oversizedResponse = {
    body: makeMockResponseBody(oversizedChunks, () => {
      canceled = true;
    }),
    headers: new Headers(),
    ok: true,
    status: 200
  };

  await assert.rejects(
    () => fetchCrx(extensionId, {
      AbortControllerImpl: MockAbortController,
      fetchImpl: () => Promise.resolve(oversizedResponse),
      userAgent: "Chrome/123.0.4567.89"
    }),
    /too large/
  );
  assert.equal(aborted, true);
  assert.equal(canceled, true);
}

async function assertExtractManifestJson() {
  const manifest = Buffer.from(JSON.stringify({ manifest_version: 3, name: "Fixture" }));
  const zip = makeZip([{ name: "manifest.json", data: manifest, deflate: true }]);
  assert.deepEqual(JSON.parse(await extractManifestJson(zip)), {
    manifest_version: 3,
    name: "Fixture"
  });

  const crx3 = makeCrx3(zip);
  assert.deepEqual(JSON.parse(await extractManifestJson(crx3)), {
    manifest_version: 3,
    name: "Fixture"
  });

  const missingManifestZip = makeZip([{ name: "readme.txt", data: Buffer.from("hello"), deflate: false }]);
  await assert.rejects(() => extractManifestJson(missingManifestZip), /No manifest\.json/);

  const invalidManifestZip = makeZip([{ name: "manifest.json", data: Buffer.from("{nope"), deflate: false }]);
  await assert.rejects(() => extractManifestJson(invalidManifestZip), /not valid JSON/);

  await assert.rejects(() => extractManifestJson(new Uint8Array([0x43, 0x72, 0x32, 0x34])), /incomplete/);
  await assert.rejects(() => extractManifestJson(new Uint8Array([1, 2, 3])), /valid ZIP/);

  const malformedEocd = Buffer.alloc(22);
  malformedEocd.writeUInt32LE(ZIP_EOCD_SIGNATURE, 0);
  malformedEocd.writeUInt16LE(1, 10);
  malformedEocd.writeUInt32LE(9999, 16);
  await assert.rejects(() => extractManifestJson(new Uint8Array(malformedEocd)), /central directory is malformed/);

  const oversizedManifestZip = makeZip([{
    name: "manifest.json",
    data: Buffer.alloc(MAX_MANIFEST_BYTES + 1, 0x20),
    deflate: false
  }]);
  await assert.rejects(() => extractManifestJson(oversizedManifestZip), /unexpectedly large/);

  const mismatchedLocalNameZip = Buffer.from(makeZip([{ name: "manifest.json", data: manifest, deflate: false }]));
  mismatchedLocalNameZip.write("xanifest.json", 30);
  await assert.rejects(
    () => extractManifestJson(new Uint8Array(mismatchedLocalNameZip)),
    /does not match/
  );

  const storedSizeMismatchZip = Buffer.from(makeZip([{ name: "manifest.json", data: manifest, deflate: false }]));
  const storedCentralOffset = getCentralDirectoryOffset(storedSizeMismatchZip);
  storedSizeMismatchZip.writeUInt32LE(manifest.length + 1, storedCentralOffset + 20);
  await assert.rejects(
    () => extractManifestJson(new Uint8Array(storedSizeMismatchZip)),
    /local file data is malformed/
  );

  const deflateSizeMismatchZip = Buffer.from(makeZip([{ name: "manifest.json", data: manifest, deflate: true }]));
  const deflateCentralOffset = getCentralDirectoryOffset(deflateSizeMismatchZip);
  deflateSizeMismatchZip.writeUInt32LE(manifest.length + 1, deflateCentralOffset + 24);
  await assert.rejects(
    () => extractManifestJson(new Uint8Array(deflateSizeMismatchZip)),
    /local file data is malformed/
  );

  const deflateBombZip = Buffer.from(makeZip([{
    name: "manifest.json",
    data: Buffer.alloc(MAX_MANIFEST_BYTES + 1, 0x20),
    deflate: true
  }]));
  const deflateBombCentralOffset = getCentralDirectoryOffset(deflateBombZip);
  deflateBombZip.writeUInt32LE(1, deflateBombCentralOffset + 24);
  await assert.rejects(() => extractManifestJson(new Uint8Array(deflateBombZip)), /unexpectedly large/);

  const truncatedCentralDirectoryZip = Buffer.from(makeZip([{ name: "manifest.json", data: manifest, deflate: false }]));
  truncatedCentralDirectoryZip.writeUInt32LE(
    getCentralDirectorySize(truncatedCentralDirectoryZip) - 1,
    truncatedCentralDirectoryZip.length - 10
  );
  await assert.rejects(
    () => extractManifestJson(new Uint8Array(truncatedCentralDirectoryZip)),
    /central directory is malformed/
  );

  const zipWithExtraDirectoryByte = Buffer.from(makeZip([{ name: "manifest.json", data: manifest, deflate: false }]));
  const eocd = zipWithExtraDirectoryByte.subarray(zipWithExtraDirectoryByte.length - 22);
  const withExtraByte = Buffer.concat([
    zipWithExtraDirectoryByte.subarray(0, zipWithExtraDirectoryByte.length - 22),
    Buffer.from([0]),
    eocd
  ]);
  withExtraByte.writeUInt32LE(getCentralDirectorySize(zipWithExtraDirectoryByte) + 1, withExtraByte.length - 10);
  await assert.rejects(
    () => extractManifestJson(new Uint8Array(withExtraByte)),
    /central directory is malformed/
  );
}

await assertParseExtensionId();
await assertFetchCrx();
await assertExtractManifestJson();

console.log("popup core tests passed");
