const EXTENSION_ID_PATTERN = /^[a-p]{32}$/;
const CHROME_WEB_STORE_HOSTS = new Set([
  "chrome.google.com",
  "chromewebstore.google.com"
]);
const MAX_CRX_BYTES = 200 * 1024 * 1024;
const MAX_INPUT_LENGTH = 2048;
const MAX_MANIFEST_BYTES = 1024 * 1024;
const CRX_MAGIC = 0x34327243;
const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP_CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const ZIP_LOCAL_FILE_SIGNATURE = 0x04034b50;
const ZIP64_SENTINEL = 0xffffffff;

export {
  CRX_MAGIC,
  MAX_CRX_BYTES,
  MAX_MANIFEST_BYTES,
  ZIP_CENTRAL_DIRECTORY_SIGNATURE,
  ZIP_EOCD_SIGNATURE,
  ZIP_LOCAL_FILE_SIGNATURE
};

export function parseExtensionId(value) {
  if (value.length > MAX_INPUT_LENGTH) {
    throw new Error("Enter a shorter Chrome Web Store URL or extension ID.");
  }

  const trimmed = value.trim().toLowerCase();

  if (EXTENSION_ID_PATTERN.test(trimmed)) {
    return trimmed;
  }

  let url;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("Enter a valid Chrome Web Store URL or 32-character extension ID.");
  }

  if (url.protocol !== "https:" || !CHROME_WEB_STORE_HOSTS.has(url.hostname)) {
    throw new Error("Enter a Chrome Web Store URL or 32-character extension ID.");
  }

  const pathId = findExtensionIdInPath(url.pathname);
  const queryId = url.searchParams.get("id");
  const id = pathId || (queryId && queryId.toLowerCase());

  if (!id || !EXTENSION_ID_PATTERN.test(id)) {
    throw new Error("The URL does not contain a valid Chrome extension ID.");
  }

  return id;
}

export async function fetchCrx(extensionId, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const userAgent = options.userAgent || globalThis.navigator?.userAgent || "";
  const AbortControllerImpl = options.AbortControllerImpl || globalThis.AbortController;

  if (typeof fetchImpl !== "function") {
    throw new Error("This browser cannot fetch CRX files.");
  }

  const controller = AbortControllerImpl ? new AbortControllerImpl() : null;
  const prodVersion = getChromeProductVersion(userAgent);
  const updateParams = new URLSearchParams({
    response: "redirect",
    prodversion: prodVersion,
    acceptformat: "crx2,crx3",
    x: `id=${extensionId}&uc`
  });
  const crxUrl = `https://clients2.google.com/service/update2/crx?${updateParams}`;
  const response = await fetchImpl(crxUrl, {
    method: "GET",
    credentials: "omit",
    cache: "no-store",
    redirect: "follow",
    signal: controller?.signal
  });

  if (!response.ok) {
    throw new Error(`Chrome Web Store returned HTTP ${response.status}.`);
  }

  const contentLengthHeader = response.headers?.get?.("content-length");
  const contentLength = contentLengthHeader === null || contentLengthHeader === undefined
    ? NaN
    : Number(contentLengthHeader);
  if (Number.isFinite(contentLength) && contentLength > MAX_CRX_BYTES) {
    controller?.abort();
    throw new Error("The extension package is too large to process safely.");
  }

  if (!response.body?.getReader) {
    controller?.abort();
    throw new Error("This browser cannot stream CRX files safely.");
  }

  return readResponseBodyLimited(response.body, controller);
}

export async function extractManifestJson(crxBytes) {
  const zipStart = getZipStartOffset(crxBytes);
  const zipBytes = crxBytes.subarray(zipStart);
  const manifestEntry = findZipEntry(zipBytes, "manifest.json");

  if (!manifestEntry) {
    throw new Error("No manifest.json was found in the extension package.");
  }

  const manifestBytes = await readZipEntry(zipBytes, manifestEntry);
  const manifestText = new TextDecoder("utf-8", { fatal: true }).decode(manifestBytes);

  try {
    JSON.parse(manifestText);
  } catch {
    throw new Error("The extracted manifest.json is not valid JSON.");
  }

  return formatJson(manifestText);
}

function findExtensionIdInPath(pathname) {
  const parts = pathname.split("/").filter(Boolean);

  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index].toLowerCase();

    if (EXTENSION_ID_PATTERN.test(part)) {
      return part;
    }
  }

  return "";
}

function getChromeProductVersion(userAgent) {
  const match = userAgent.match(/(?:Chrome|Chromium|Edg)\/(\d+\.\d+\.\d+\.\d+)/);
  return match ? match[1] : "120.0.0.0";
}

async function readResponseBodyLimited(body, controller) {
  const reader = body.getReader();
  const chunks = [];
  let totalLength = 0;

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
    totalLength += chunk.byteLength;

    if (totalLength > MAX_CRX_BYTES) {
      controller?.abort();
      await reader.cancel("CRX response exceeded safe size").catch(() => {});
      throw new Error("The extension package is too large to process safely.");
    }

    chunks.push(chunk);
  }

  const output = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return output;
}

function getZipStartOffset(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  if (bytes.byteLength >= 4 && view.getUint32(0, true) === CRX_MAGIC) {
    if (bytes.byteLength < 8) {
      throw new Error("The CRX package header is incomplete.");
    }

    const version = view.getUint32(4, true);

    if (version === 2) {
      if (bytes.byteLength < 16) {
        throw new Error("The CRX2 package header is incomplete.");
      }

      const publicKeyLength = view.getUint32(8, true);
      const signatureLength = view.getUint32(12, true);
      const zipStart = 16 + publicKeyLength + signatureLength;

      if (zipStart > bytes.byteLength) {
        throw new Error("The CRX2 package header is malformed.");
      }

      return zipStart;
    }

    if (version === 3) {
      if (bytes.byteLength < 12) {
        throw new Error("The CRX3 package header is incomplete.");
      }

      const zipStart = 12 + view.getUint32(8, true);

      if (zipStart > bytes.byteLength) {
        throw new Error("The CRX3 package header is malformed.");
      }

      return zipStart;
    }

    throw new Error(`Unsupported CRX version ${version}.`);
  }

  return 0;
}

function findZipEntry(zipBytes, wantedName) {
  const view = new DataView(zipBytes.buffer, zipBytes.byteOffset, zipBytes.byteLength);
  const eocdOffset = findEndOfCentralDirectory(view);
  const centralDirectoryOffset = view.getUint32(eocdOffset + 16, true);
  const centralDirectorySize = view.getUint32(eocdOffset + 12, true);
  const entryCount = view.getUint16(eocdOffset + 10, true);

  if (
    centralDirectoryOffset === ZIP64_SENTINEL ||
    centralDirectorySize === ZIP64_SENTINEL ||
    entryCount === 0xffff
  ) {
    throw new Error("ZIP64 extension packages are not supported yet.");
  }

  if (
    centralDirectoryOffset > zipBytes.byteLength ||
    centralDirectorySize > zipBytes.byteLength - centralDirectoryOffset ||
    centralDirectoryOffset + centralDirectorySize > eocdOffset
  ) {
    throw new Error("The ZIP central directory is malformed.");
  }

  const centralDirectoryEnd = centralDirectoryOffset + centralDirectorySize;
  let foundEntry = null;
  let offset = centralDirectoryOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > centralDirectoryEnd) {
      throw new Error("The ZIP central directory is malformed.");
    }

    if (view.getUint32(offset, true) !== ZIP_CENTRAL_DIRECTORY_SIGNATURE) {
      throw new Error("The ZIP central directory is malformed.");
    }

    const compressionMethod = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const fileNameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const fileNameStart = offset + 46;
    const fileNameEnd = fileNameStart + fileNameLength;
    const nextOffset = fileNameEnd + extraLength + commentLength;

    if (nextOffset > centralDirectoryEnd) {
      throw new Error("The ZIP central directory is malformed.");
    }

    const fileName = new TextDecoder("utf-8").decode(zipBytes.subarray(fileNameStart, fileNameEnd));

    if (fileName === wantedName) {
      foundEntry = {
        fileName,
        compressionMethod,
        compressedSize,
        uncompressedSize,
        localHeaderOffset
      };
    }

    offset = nextOffset;
  }

  if (offset !== centralDirectoryEnd) {
    throw new Error("The ZIP central directory is malformed.");
  }

  return foundEntry;
}

function findEndOfCentralDirectory(view) {
  if (view.byteLength < 22) {
    throw new Error("The extension package is not a valid ZIP archive.");
  }

  const minOffset = Math.max(0, view.byteLength - 0xffff - 22);

  for (let offset = view.byteLength - 22; offset >= minOffset; offset -= 1) {
    if (view.getUint32(offset, true) === ZIP_EOCD_SIGNATURE) {
      const commentLength = view.getUint16(offset + 20, true);

      if (offset + 22 + commentLength !== view.byteLength) {
        continue;
      }

      return offset;
    }
  }

  throw new Error("The extension package is not a valid ZIP archive.");
}

async function readZipEntry(zipBytes, entry) {
  const view = new DataView(zipBytes.buffer, zipBytes.byteOffset, zipBytes.byteLength);
  const offset = entry.localHeaderOffset;

  if (offset + 30 > zipBytes.byteLength) {
    throw new Error("The ZIP local file header is malformed.");
  }

  if (view.getUint32(offset, true) !== ZIP_LOCAL_FILE_SIGNATURE) {
    throw new Error("The ZIP local file header is malformed.");
  }

  if (entry.uncompressedSize > MAX_MANIFEST_BYTES) {
    throw new Error("The manifest.json file is unexpectedly large.");
  }

  const fileNameLength = view.getUint16(offset + 26, true);
  const extraLength = view.getUint16(offset + 28, true);
  const dataStart = offset + 30 + fileNameLength + extraLength;

  if (dataStart > zipBytes.byteLength) {
    throw new Error("The ZIP local file header is malformed.");
  }

  const dataEnd = dataStart + entry.compressedSize;

  if (dataEnd > zipBytes.byteLength) {
    throw new Error("The ZIP local file data is malformed.");
  }

  const localFileName = new TextDecoder("utf-8").decode(zipBytes.subarray(offset + 30, offset + 30 + fileNameLength));
  if (localFileName !== entry.fileName) {
    throw new Error("The ZIP local file header does not match the central directory.");
  }

  const compressedBytes = zipBytes.subarray(dataStart, dataEnd);

  if (entry.compressionMethod === 0) {
    if (entry.compressedSize !== entry.uncompressedSize) {
      throw new Error("The ZIP local file data is malformed.");
    }

    return compressedBytes;
  }

  if (entry.compressionMethod === 8) {
    if (!("DecompressionStream" in globalThis)) {
      throw new Error("This browser cannot decompress CRX files. Try a recent Chrome or Chromium build.");
    }

    return inflateRaw(compressedBytes, entry.uncompressedSize);
  }

  throw new Error(`Unsupported ZIP compression method ${entry.compressionMethod}.`);
}

async function inflateRaw(bytes, expectedSize) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const reader = stream.getReader();
  const chunks = [];
  let totalLength = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      totalLength += value.byteLength;
      if (totalLength > MAX_MANIFEST_BYTES) {
        throw new Error("The manifest.json file is unexpectedly large.");
      }

      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel(error).catch(() => {});
    throw error;
  }

  if (totalLength !== expectedSize) {
    throw new Error("The ZIP local file data is malformed.");
  }

  const output = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return output;
}

function formatJson(text) {
  return `${JSON.stringify(JSON.parse(text), null, 2)}\n`;
}
