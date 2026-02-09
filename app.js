const fileInput = document.getElementById("fileInput");
const fileName = document.getElementById("fileName");
const pdfCanvas = document.getElementById("pdfCanvas");
const overlayCanvas = document.getElementById("overlayCanvas");
const emptyState = document.getElementById("emptyState");
const pageInfo = document.getElementById("pageInfo");
const prevPageBtn = document.getElementById("prevPage");
const nextPageBtn = document.getElementById("nextPage");
const applyBtn = document.getElementById("applyRedaction");
const clearBtn = document.getElementById("clearSelection");
const undoBtn = document.getElementById("undoRedaction");
const downloadBtn = document.getElementById("downloadPdf");
const statusText = document.getElementById("statusText");
const canvasHost = document.getElementById("canvasHost");

pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

const state = {
  pdfBytes: null,
  pdfDoc: null,
  numPages: 0,
  currentPage: 1,
  viewport: null,
  selection: null,
  pageSizes: new Map(),
  redactions: new Map()
};

let isSelecting = false;
let selectStart = null;

function setStatus(message) {
  statusText.textContent = message;
}

function updateUI() {
  const hasPdf = !!state.pdfDoc;
  const hasSelection = state.selection && state.selection.w > 1 && state.selection.h > 1;
  const pageRedactions = state.redactions.get(state.currentPage) || [];

  pageInfo.textContent = hasPdf ? `Page ${state.currentPage} / ${state.numPages}` : "Page 0 / 0";
  prevPageBtn.disabled = !hasPdf || state.currentPage === 1;
  nextPageBtn.disabled = !hasPdf || state.currentPage === state.numPages;
  applyBtn.disabled = !hasSelection;
  clearBtn.disabled = !hasSelection;
  undoBtn.disabled = !hasPdf || pageRedactions.length === 0;
  downloadBtn.disabled = !hasPdf;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function getCanvasPoint(event) {
  const rect = overlayCanvas.getBoundingClientRect();
  const scaleX = overlayCanvas.width / rect.width;
  const scaleY = overlayCanvas.height / rect.height;
  return {
    x: (event.clientX - rect.left) * scaleX,
    y: (event.clientY - rect.top) * scaleY
  };
}

function canvasRectToPdf(rect, pageSize, viewport) {
  const scaleX = pageSize.width / viewport.width;
  const scaleY = pageSize.height / viewport.height;
  const x = rect.x * scaleX;
  const w = rect.w * scaleX;
  const yTop = rect.y * scaleY;
  const h = rect.h * scaleY;
  const y = pageSize.height - (yTop + h);
  return { x, y, w, h };
}

function pdfRectToCanvas(rect, pageSize, viewport) {
  const scaleX = viewport.width / pageSize.width;
  const scaleY = viewport.height / pageSize.height;
  const x = rect.x * scaleX;
  const w = rect.w * scaleX;
  const y = viewport.height - (rect.y + rect.h) * scaleY;
  const h = rect.h * scaleY;
  return { x, y, w, h };
}

async function renderPage(pageNumber) {
  if (!state.pdfDoc) return;
  setStatus("Rendering page...");
  const page = await state.pdfDoc.getPage(pageNumber);
  const baseViewport = page.getViewport({ scale: 1 });
  state.pageSizes.set(pageNumber, { width: baseViewport.width, height: baseViewport.height });

  const hostStyle = getComputedStyle(canvasHost);
  const padX = parseFloat(hostStyle.paddingLeft) + parseFloat(hostStyle.paddingRight);
  const hostWidth = Math.max(320, canvasHost.clientWidth - padX);
  const widthScale = hostWidth / baseViewport.width;
  const scale = clamp(widthScale, 0.4, 3);
  const viewport = page.getViewport({ scale });
  state.viewport = viewport;

  pdfCanvas.width = viewport.width;
  pdfCanvas.height = viewport.height;
  overlayCanvas.width = viewport.width;
  overlayCanvas.height = viewport.height;

  pdfCanvas.style.width = `${viewport.width}px`;
  pdfCanvas.style.height = `${viewport.height}px`;
  overlayCanvas.style.width = `${viewport.width}px`;
  overlayCanvas.style.height = `${viewport.height}px`;

  const ctx = pdfCanvas.getContext("2d", { alpha: false });
  await page.render({ canvasContext: ctx, viewport }).promise;

  emptyState.style.display = "none";
  drawOverlay();
  updateUI();
  setStatus(`Page ${pageNumber} ready`);
}

function drawOverlay() {
  const ctx = overlayCanvas.getContext("2d");
  ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

  const pageSize = state.pageSizes.get(state.currentPage);
  const viewport = state.viewport;
  if (pageSize && viewport) {
    const rects = state.redactions.get(state.currentPage) || [];
    ctx.fillStyle = "rgba(0, 0, 0, 1)";
    rects.forEach((rect) => {
      const c = pdfRectToCanvas(rect, pageSize, viewport);
      ctx.fillRect(c.x, c.y, c.w, c.h);
    });
  }

  if (state.selection) {
    ctx.strokeStyle = "#ff3b30";
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(state.selection.x, state.selection.y, state.selection.w, state.selection.h);
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(255, 59, 48, 0.18)";
    ctx.fillRect(state.selection.x, state.selection.y, state.selection.w, state.selection.h);
  }
}

async function loadPdf(file) {
  const rawBuffer = await file.arrayBuffer();
  const rawBytes = new Uint8Array(rawBuffer);
  const bytesForPdfjs = rawBytes.slice();
  const bytesForSave = rawBytes.slice();
  state.pdfBytes = bytesForSave;
  state.pdfDoc = await pdfjsLib.getDocument({ data: bytesForPdfjs }).promise;
  state.numPages = state.pdfDoc.numPages;
  state.currentPage = 1;
  state.selection = null;
  state.redactions.clear();
  fileName.textContent = file.name;
  await renderPage(state.currentPage);
}

fileInput.addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    setStatus("Loading PDF...");
    await loadPdf(file);
  } catch (error) {
    console.error(error);
    setStatus("Failed to load PDF.");
  }
});

prevPageBtn.addEventListener("click", async () => {
  if (state.currentPage <= 1) return;
  state.currentPage -= 1;
  state.selection = null;
  await renderPage(state.currentPage);
});

nextPageBtn.addEventListener("click", async () => {
  if (state.currentPage >= state.numPages) return;
  state.currentPage += 1;
  state.selection = null;
  await renderPage(state.currentPage);
});

applyBtn.addEventListener("click", () => {
  if (!state.selection || !state.viewport) return;
  if (state.selection.w < 2 || state.selection.h < 2) return;

  const pageSize = state.pageSizes.get(state.currentPage);
  if (!pageSize) return;

  const padding = 2;
  const paddedX = clamp(state.selection.x - padding, 0, overlayCanvas.width);
  const paddedY = clamp(state.selection.y - padding, 0, overlayCanvas.height);
  const maxW = overlayCanvas.width - paddedX;
  const maxH = overlayCanvas.height - paddedY;
  const paddedSelection = {
    x: paddedX,
    y: paddedY,
    w: clamp(state.selection.w + padding * 2, 0, maxW),
    h: clamp(state.selection.h + padding * 2, 0, maxH)
  };

  const rectPdf = canvasRectToPdf(paddedSelection, pageSize, state.viewport);
  const list = state.redactions.get(state.currentPage) || [];
  list.push(rectPdf);
  state.redactions.set(state.currentPage, list);
  state.selection = null;
  drawOverlay();
  updateUI();
  setStatus("Redaction applied");
});

clearBtn.addEventListener("click", () => {
  state.selection = null;
  drawOverlay();
  updateUI();
});

undoBtn.addEventListener("click", () => {
  const list = state.redactions.get(state.currentPage) || [];
  list.pop();
  state.redactions.set(state.currentPage, list);
  drawOverlay();
  updateUI();
});

overlayCanvas.addEventListener("pointerdown", (event) => {
  if (!state.pdfDoc) return;
  isSelecting = true;
  selectStart = getCanvasPoint(event);
  state.selection = { x: selectStart.x, y: selectStart.y, w: 0, h: 0 };
  overlayCanvas.setPointerCapture(event.pointerId);
  drawOverlay();
  updateUI();
});

overlayCanvas.addEventListener("pointermove", (event) => {
  if (!isSelecting || !selectStart) return;
  const current = getCanvasPoint(event);
  const x = Math.min(selectStart.x, current.x);
  const y = Math.min(selectStart.y, current.y);
  const w = Math.abs(selectStart.x - current.x);
  const h = Math.abs(selectStart.y - current.y);
  state.selection = { x, y, w, h };
  drawOverlay();
  updateUI();
});

overlayCanvas.addEventListener("pointerup", (event) => {
  if (!isSelecting) return;
  isSelecting = false;
  overlayCanvas.releasePointerCapture(event.pointerId);
  drawOverlay();
  updateUI();
});

overlayCanvas.addEventListener("pointerleave", () => {
  if (!isSelecting) return;
  isSelecting = false;
  drawOverlay();
  updateUI();
});

async function savePdf() {
  if (!state.pdfBytes) return;
  setStatus("Preparing PDF...");

  const pdfDoc = await PDFLib.PDFDocument.load(state.pdfBytes, {
    ignoreEncryption: true
  });
  for (let i = 0; i < state.numPages; i += 1) {
    const pageIndex = i + 1;
    const rects = state.redactions.get(pageIndex) || [];
    if (rects.length === 0) continue;

    const page = pdfDoc.getPage(i);
    rects.forEach((rect) => {
      page.drawRectangle({
        x: rect.x,
        y: rect.y,
        width: rect.w,
        height: rect.h,
        color: PDFLib.rgb(0, 0, 0),
        opacity: 1,
        borderWidth: 0
      });
    });
  }

  const output = await pdfDoc.save();
  const blob = new Blob([output], { type: "application/pdf" });

  const suggestedName = fileName.textContent.replace(/\.pdf$/i, "") + "-redacted.pdf";

  if (window.showSaveFilePicker) {
    const handle = await window.showSaveFilePicker({
      suggestedName,
      types: [
        {
          description: "PDF Document",
          accept: { "application/pdf": [".pdf"] }
        }
      ]
    });
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    setStatus("Saved with file picker");
    return;
  }

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = suggestedName;
  anchor.click();
  URL.revokeObjectURL(url);
  setStatus("Download started");
}

downloadBtn.addEventListener("click", async () => {
  try {
    await savePdf();
  } catch (error) {
    console.error(error);
    setStatus("Failed to save PDF.");
  }
});

let resizeTimer = null;
function scheduleRender() {
  if (!state.pdfDoc) return;
  if (resizeTimer) clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    renderPage(state.currentPage);
  }, 120);
}

window.addEventListener("resize", scheduleRender);

const hostObserver = new ResizeObserver(() => {
  scheduleRender();
});
hostObserver.observe(canvasHost);

updateUI();
