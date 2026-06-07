const VERSION = "0.1.0";

const DEFAULT_BASE_URL = "https://data.hub.api.metoffice.gov.uk/map-images/1.0.0";
const DEFAULT_BOUNDS = {
  south: 48,
  west: -12,
  north: 61,
  east: 5
};

const STORAGE_KEYS = {
  apiKey: "metoffice.weather.apiKey",
  rememberKey: "metoffice.weather.rememberKey",
  baseUrl: "metoffice.weather.baseUrl",
  orderId: "metoffice.weather.orderId",
  bounds: "metoffice.weather.bounds"
};

const state = {
  map: null,
  overlay: null,
  overlayImageUrl: null,
  overlayImage: null,
  sampleCanvas: null,
  sampleContext: null,
  latestOrder: null,
  files: [],
  selectedFileId: "",
  isBusy: false
};

const el = {
  versionPill: document.getElementById("versionPill"),
  panel: document.getElementById("panel"),
  panelToggle: document.getElementById("panelToggle"),
  apiKey: document.getElementById("apiKey"),
  rememberKey: document.getElementById("rememberKey"),
  baseUrl: document.getElementById("baseUrl"),
  orderInput: document.getElementById("orderInput"),
  orderSelect: document.getElementById("orderSelect"),
  listOrdersButton: document.getElementById("listOrdersButton"),
  loadLatestButton: document.getElementById("loadLatestButton"),
  fileSelect: document.getElementById("fileSelect"),
  previousFileButton: document.getElementById("previousFileButton"),
  nextFileButton: document.getElementById("nextFileButton"),
  includeLand: document.getElementById("includeLand"),
  opacity: document.getElementById("opacity"),
  opacityOutput: document.getElementById("opacityOutput"),
  fitButton: document.getElementById("fitButton"),
  clearOverlayButton: document.getElementById("clearOverlayButton"),
  copyDebugButton: document.getElementById("copyDebugButton"),
  southBound: document.getElementById("southBound"),
  westBound: document.getElementById("westBound"),
  northBound: document.getElementById("northBound"),
  eastBound: document.getElementById("eastBound"),
  diagnostics: document.getElementById("diagnostics"),
  pixelReadout: document.getElementById("pixelReadout"),
  pixelSwatch: document.getElementById("pixelSwatch"),
  toast: document.getElementById("toast")
};

function init() {
  el.versionPill.textContent = `v${VERSION}`;

  restoreSettings();
  initMap();
  bindEvents();
  updateOpacityOutput();
  renderDiagnostics({
    status: "Ready",
    source: "Met Office DataHub",
    note: "Paste an API key, then list orders."
  });
}

function restoreSettings() {
  el.baseUrl.value = localStorage.getItem(STORAGE_KEYS.baseUrl) || DEFAULT_BASE_URL;
  el.orderInput.value = localStorage.getItem(STORAGE_KEYS.orderId) || "";

  const remember = localStorage.getItem(STORAGE_KEYS.rememberKey) === "true";
  el.rememberKey.checked = remember;
  el.apiKey.value = remember ? localStorage.getItem(STORAGE_KEYS.apiKey) || "" : "";

  const storedBounds = safeJsonParse(localStorage.getItem(STORAGE_KEYS.bounds));
  const bounds = validBounds(storedBounds) ? storedBounds : DEFAULT_BOUNDS;

  el.southBound.value = bounds.south;
  el.westBound.value = bounds.west;
  el.northBound.value = bounds.north;
  el.eastBound.value = bounds.east;
}

function initMap() {
  state.map = L.map("map", {
    zoomControl: true,
    attributionControl: true,
    preferCanvas: true
  });

  state.map.fitBounds(getLeafletBounds(), { padding: [14, 14] });

  L.control.attribution({ prefix: false })
    .addTo(state.map)
    .addAttribution("Met Office Weather DataHub")
    .addAttribution("Leaflet");

  drawBoundsFrame();

  state.map.on("click", handleMapClick);
}

function bindEvents() {
  el.panelToggle.addEventListener("click", togglePanel);
  el.listOrdersButton.addEventListener("click", listOrders);
  el.loadLatestButton.addEventListener("click", loadLatestOrder);

  el.orderSelect.addEventListener("change", () => {
    el.orderInput.value = el.orderSelect.value;
    persistNonSecretSettings();
  });

  el.fileSelect.addEventListener("change", () => {
    state.selectedFileId = el.fileSelect.value;
    loadSelectedFile();
  });

  el.previousFileButton.addEventListener("click", () => shiftSelectedFile(-1));
  el.nextFileButton.addEventListener("click", () => shiftSelectedFile(1));

  el.includeLand.addEventListener("change", () => {
    if (state.selectedFileId) {
      loadSelectedFile();
    }
  });

  el.opacity.addEventListener("input", () => {
    updateOpacityOutput();
    if (state.overlay) {
      state.overlay.setOpacity(getOpacity());
    }
  });

  el.fitButton.addEventListener("click", () => state.map.fitBounds(getLeafletBounds(), { padding: [14, 14] }));
  el.clearOverlayButton.addEventListener("click", clearOverlay);
  el.copyDebugButton.addEventListener("click", copyDebug);

  for (const input of [el.baseUrl, el.orderInput, el.southBound, el.westBound, el.northBound, el.eastBound]) {
    input.addEventListener("change", persistNonSecretSettings);
  }

  el.rememberKey.addEventListener("change", persistKeySetting);
  el.apiKey.addEventListener("change", persistKeySetting);

  for (const input of [el.southBound, el.westBound, el.northBound, el.eastBound]) {
    input.addEventListener("change", () => {
      if (state.overlay) {
        state.overlay.setBounds(getLeafletBounds());
      }
      drawBoundsFrame();
      state.map.fitBounds(getLeafletBounds(), { padding: [14, 14] });
    });
  }
}

function togglePanel() {
  const collapsed = el.panel.classList.toggle("is-collapsed");
  el.panelToggle.setAttribute("aria-expanded", String(!collapsed));
  window.setTimeout(() => state.map.invalidateSize(), 160);
}

async function listOrders() {
  const apiKey = getApiKey();
  if (!apiKey) {
    showToast("Paste your Met Office API key first.");
    return;
  }

  setBusy(true, "Loading orders");

  try {
    const data = await metOfficeJson("/orders");
    const orders = Array.isArray(data.orders) ? data.orders : [];

    el.orderSelect.innerHTML = "";

    if (!orders.length) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "No active orders found";
      el.orderSelect.appendChild(option);

      renderDiagnostics({
        status: "No orders",
        response: "The key worked, but no active orders came back.",
        next: "Create a Map Images order in Weather DataHub."
      });
      return;
    }

    for (const order of orders) {
      const orderId = order.orderId || order.id || order.name || "";
      const option = document.createElement("option");
      option.value = orderId;
      option.textContent = [
        orderId,
        order.modelId ? `model: ${order.modelId}` : "",
        order.requiredLatestRuns ? `runs: ${order.requiredLatestRuns.join(", ")}` : ""
      ].filter(Boolean).join(" · ");
      el.orderSelect.appendChild(option);
    }

    if (!el.orderInput.value) {
      el.orderInput.value = el.orderSelect.value;
    }

    persistNonSecretSettings();

    renderDiagnostics({
      status: "Orders loaded",
      count: String(orders.length),
      selected: el.orderInput.value || "none"
    });
  } catch (error) {
    handleFetchError(error, "Could not list Met Office orders");
  } finally {
    setBusy(false);
  }
}

async function loadLatestOrder() {
  const orderId = getOrderId();
  if (!getApiKey()) {
    showToast("Paste your Met Office API key first.");
    return;
  }
  if (!orderId) {
    showToast("Enter or select an order ID first.");
    return;
  }

  setBusy(true, "Loading latest order");

  try {
    const data = await metOfficeJson(`/orders/${encodePathId(orderId)}/latest?detail=MINIMAL`);
    state.latestOrder = data;

    const files = (((data || {}).orderDetails || {}).files || [])
      .map((file) => ({
        fileId: file.fileId || file.id || "",
        raw: file
      }))
      .filter((file) => file.fileId);

    state.files = files;
    populateFileSelect(files);

    if (!files.length) {
      renderDiagnostics({
        status: "Order loaded, no files",
        order: orderId,
        next: "Check the order has a completed run and contains Map Images files."
      });
      return;
    }

    state.selectedFileId = files[0].fileId;
    el.fileSelect.value = state.selectedFileId;
    await loadSelectedFile();
  } catch (error) {
    handleFetchError(error, "Could not load latest order");
  } finally {
    setBusy(false);
  }
}

function populateFileSelect(files) {
  el.fileSelect.innerHTML = "";

  if (!files.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No files";
    el.fileSelect.appendChild(option);
    return;
  }

  files.forEach((file, index) => {
    const option = document.createElement("option");
    option.value = file.fileId;
    option.textContent = `${String(index + 1).padStart(2, "0")} · ${friendlyFileLabel(file.fileId)}`;
    el.fileSelect.appendChild(option);
  });
}

async function loadSelectedFile() {
  if (!state.selectedFileId) {
    return;
  }

  const orderId = getOrderId();
  const query = el.includeLand.checked ? "?includeLand=true" : "";
  const path = `/orders/${encodePathId(orderId)}/latest/${encodePathId(state.selectedFileId)}/data${query}`;

  setBusy(true, "Loading PNG");

  try {
    const blob = await metOfficePng(path);
    const objectUrl = URL.createObjectURL(blob);

    await setOverlayFromObjectUrl(objectUrl);

    renderDiagnostics({
      status: "PNG loaded",
      order: orderId,
      file: state.selectedFileId,
      label: friendlyFileLabel(state.selectedFileId),
      land: el.includeLand.checked ? "Met Office land included" : "transparent/no land requested",
      opacity: `${Math.round(getOpacity() * 100)}%`
    });
  } catch (error) {
    handleFetchError(error, "Could not load PNG file");
  } finally {
    setBusy(false);
  }
}

async function setOverlayFromObjectUrl(objectUrl) {
  clearOverlay(false);

  state.overlayImageUrl = objectUrl;

  state.overlay = L.imageOverlay(objectUrl, getLeafletBounds(), {
    opacity: getOpacity(),
    interactive: false
  }).addTo(state.map);

  state.overlayImage = await loadImage(objectUrl);
  prepareSampleCanvas(state.overlayImage);
}

function clearOverlay(showMessage = true) {
  if (state.overlay) {
    state.map.removeLayer(state.overlay);
    state.overlay = null;
  }

  if (state.overlayImageUrl) {
    URL.revokeObjectURL(state.overlayImageUrl);
  }

  state.overlayImageUrl = null;
  state.overlayImage = null;
  state.sampleCanvas = null;
  state.sampleContext = null;
  state.selectedFileId = "";
  el.pixelSwatch.style.background = "transparent";
  el.pixelReadout.textContent = "Click the map after loading a PNG to sample the rendered pixel colour.";

  if (showMessage) {
    renderDiagnostics({
      status: "Overlay cleared"
    });
  }
}

function drawBoundsFrame() {
  if (state.boundsFrame) {
    state.map.removeLayer(state.boundsFrame);
  }

  state.boundsFrame = L.rectangle(getLeafletBounds(), {
    color: "#132033",
    weight: 1,
    opacity: 0.42,
    fill: false,
    dashArray: "5 6"
  }).addTo(state.map);
}

function prepareSampleCanvas(image) {
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;

  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, 0, 0);

  state.sampleCanvas = canvas;
  state.sampleContext = context;
}

function handleMapClick(event) {
  if (!state.sampleCanvas || !state.sampleContext) {
    return;
  }

  const bounds = getBoundsObject();
  const lng = event.latlng.lng;
  const lat = event.latlng.lat;

  if (lng < bounds.west || lng > bounds.east || lat < bounds.south || lat > bounds.north) {
    el.pixelReadout.textContent = "Clicked outside the configured image bounds.";
    el.pixelSwatch.style.background = "transparent";
    return;
  }

  const xRatio = (lng - bounds.west) / (bounds.east - bounds.west);
  const yRatio = (bounds.north - lat) / (bounds.north - bounds.south);

  const x = clamp(Math.floor(xRatio * state.sampleCanvas.width), 0, state.sampleCanvas.width - 1);
  const y = clamp(Math.floor(yRatio * state.sampleCanvas.height), 0, state.sampleCanvas.height - 1);
  const data = state.sampleContext.getImageData(x, y, 1, 1).data;
  const rgba = `rgba(${data[0]}, ${data[1]}, ${data[2]}, ${(data[3] / 255).toFixed(2)})`;
  const hex = rgbToHex(data[0], data[1], data[2]);

  el.pixelSwatch.style.background = rgba;
  el.pixelReadout.textContent = `${hex} · alpha ${data[3]} · lat ${lat.toFixed(3)}, lon ${lng.toFixed(3)}`;
}

function shiftSelectedFile(delta) {
  if (!state.files.length) {
    return;
  }

  const currentIndex = state.files.findIndex((file) => file.fileId === el.fileSelect.value);
  const nextIndex = clamp(currentIndex + delta, 0, state.files.length - 1);

  el.fileSelect.value = state.files[nextIndex].fileId;
  state.selectedFileId = el.fileSelect.value;
  loadSelectedFile();
}

async function metOfficeJson(path) {
  const response = await metOfficeFetch(path, "application/json");
  return response.json();
}

async function metOfficePng(path) {
  const response = await metOfficeFetch(path, "image/png");
  return response.blob();
}

async function metOfficeFetch(path, accept) {
  const baseUrl = el.baseUrl.value.trim().replace(/\/$/, "");
  const url = `${baseUrl}${path}`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      "Accept": accept,
      "apikey": getApiKey()
    },
    mode: "cors",
    cache: "no-store"
  });

  if (!response.ok) {
    const text = await safeReadText(response);
    throw new Error(`HTTP ${response.status} ${response.statusText}${text ? ` — ${text.slice(0, 240)}` : ""}`);
  }

  return response;
}

function setBusy(isBusy, label = "Working") {
  state.isBusy = isBusy;

  for (const button of [
    el.listOrdersButton,
    el.loadLatestButton,
    el.previousFileButton,
    el.nextFileButton,
    el.fitButton,
    el.clearOverlayButton,
    el.copyDebugButton
  ]) {
    button.disabled = isBusy;
  }

  if (isBusy) {
    el.versionPill.textContent = label;
  } else {
    el.versionPill.textContent = `v${VERSION}`;
  }
}

function renderDiagnostics(rows) {
  el.diagnostics.innerHTML = "";

  for (const [key, value] of Object.entries(rows)) {
    const row = document.createElement("div");
    row.className = "diagnostics-row";

    const dt = document.createElement("dt");
    dt.textContent = key;

    const dd = document.createElement("dd");
    dd.textContent = String(value);

    row.append(dt, dd);
    el.diagnostics.appendChild(row);
  }
}

function handleFetchError(error, title) {
  const message = error instanceof Error ? error.message : String(error);

  renderDiagnostics({
    status: title,
    error: message,
    likely: message.toLowerCase().includes("failed to fetch")
      ? "Browser/CORS block or network/API gateway issue."
      : "Check API key, order ID, subscription and run availability."
  });

  showToast(title);
}

function persistNonSecretSettings() {
  localStorage.setItem(STORAGE_KEYS.baseUrl, el.baseUrl.value.trim());
  localStorage.setItem(STORAGE_KEYS.orderId, el.orderInput.value.trim());

  const bounds = getBoundsObject();
  if (validBounds(bounds)) {
    localStorage.setItem(STORAGE_KEYS.bounds, JSON.stringify(bounds));
  }
}

function persistKeySetting() {
  localStorage.setItem(STORAGE_KEYS.rememberKey, String(el.rememberKey.checked));

  if (el.rememberKey.checked) {
    localStorage.setItem(STORAGE_KEYS.apiKey, el.apiKey.value.trim());
  } else {
    localStorage.removeItem(STORAGE_KEYS.apiKey);
  }
}

function getApiKey() {
  return el.apiKey.value.trim();
}

function getOrderId() {
  return el.orderInput.value.trim() || el.orderSelect.value.trim();
}

function getOpacity() {
  return Number(el.opacity.value) / 100;
}

function updateOpacityOutput() {
  el.opacityOutput.textContent = `${el.opacity.value}%`;
}

function getBoundsObject() {
  return {
    south: Number(el.southBound.value),
    west: Number(el.westBound.value),
    north: Number(el.northBound.value),
    east: Number(el.eastBound.value)
  };
}

function getLeafletBounds() {
  const bounds = getBoundsObject();
  return [
    [bounds.south, bounds.west],
    [bounds.north, bounds.east]
  ];
}

function validBounds(bounds) {
  return bounds
    && Number.isFinite(Number(bounds.south))
    && Number.isFinite(Number(bounds.west))
    && Number.isFinite(Number(bounds.north))
    && Number.isFinite(Number(bounds.east))
    && Number(bounds.south) < Number(bounds.north)
    && Number(bounds.west) < Number(bounds.east);
}

function friendlyFileLabel(fileId) {
  const runMatch = fileId.match(/_\+(\d{2})/);
  const stepMatch = fileId.match(/\+(\d{1,3})(?!.*\+\d)/);
  const parts = [];

  if (runMatch) {
    parts.push(`run ${runMatch[1]} UTC`);
  }

  if (stepMatch) {
    parts.push(`T+${stepMatch[1]}h`);
  }

  const parameter = fileId
    .replace(/[_-]\+\d{2}.*$/, "")
    .split("/")
    .pop()
    .replace(/[_-]+/g, " ")
    .trim();

  if (parameter) {
    parts.unshift(parameter);
  }

  return parts.length ? parts.join(" · ") : fileId;
}

function encodePathId(value) {
  return String(value)
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("PNG loaded but could not be decoded as an image."));
    image.src = url;
  });
}

async function safeReadText(response) {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function rgbToHex(red, green, blue) {
  return `#${[red, green, blue]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")}`;
}

async function copyDebug() {
  const payload = {
    version: VERSION,
    baseUrl: el.baseUrl.value.trim(),
    orderId: getOrderId(),
    selectedFileId: state.selectedFileId,
    includeLand: el.includeLand.checked,
    bounds: getBoundsObject(),
    filesLoaded: state.files.length,
    latestOrderKeys: state.latestOrder ? Object.keys(state.latestOrder) : [],
    userAgent: navigator.userAgent
  };

  try {
    await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
    showToast("Debug copied");
  } catch {
    showToast("Clipboard blocked");
  }
}

function showToast(message) {
  el.toast.textContent = message;
  el.toast.classList.add("is-visible");

  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    el.toast.classList.remove("is-visible");
  }, 1800);
}

init();
