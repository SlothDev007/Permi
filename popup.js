import {
  extractManifestJson,
  fetchCrx,
  parseExtensionId
} from "./popup-core.mjs";

const form = document.getElementById("manifest-form");
const input = document.getElementById("extension-input");
const button = document.getElementById("download-button");
const buttonText = button.querySelector(".button-text");
const statusEl = document.getElementById("status");

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  setBusy(true);
  setStatus("Fetching extension package...", "neutral");

  try {
    const extensionId = parseExtensionId(input.value);
    const crxBytes = await fetchCrx(extensionId);
    setStatus("Extracting manifest.json...", "neutral");

    const manifestText = await extractManifestJson(crxBytes);
    const fileName = `${extensionId}-manifest.json`;
    await downloadManifest(fileName, manifestText);

    setStatus(`Saved ${fileName}`, "success");
  } catch (error) {
    setStatus(error.message || "Unable to fetch the manifest.", "error");
  } finally {
    setBusy(false);
  }
});

async function downloadManifest(fileName, manifestText) {
  const blob = new Blob([manifestText], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  try {
    await chrome.downloads.download({
      url,
      filename: fileName,
      saveAs: true,
      conflictAction: "uniquify"
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function setBusy(isBusy) {
  input.disabled = isBusy;
  button.disabled = isBusy;
  button.classList.toggle("is-busy", isBusy);
  buttonText.textContent = isBusy ? "Extracting..." : "Extract manifest";
}

function setStatus(message, type) {
  statusEl.textContent = message;
  statusEl.dataset.type = type;
}
