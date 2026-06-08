// Cache all DOM references once so the editor logic can stay state-driven.
const els = {
  audio: document.getElementById("audioPlayer"),
  appModal: document.getElementById("appModal"),
  canvas: document.getElementById("waveformCanvas"),
  dropZone: document.getElementById("dropZone"),
  emptyPreview: document.getElementById("emptyPreview"),
  endTime: document.getElementById("endTime"),
  exportButton: document.getElementById("exportButton"),
  exportMenu: document.getElementById("exportMenu"),
  exportSrtOption: document.getElementById("exportSrtOption"),
  exportVttOption: document.getElementById("exportVttOption"),
  editorGrid: document.getElementById("editorGrid"),
  helpPanel: document.getElementById("helpPanel"),
  helpToggle: document.getElementById("helpToggle"),
  input: document.getElementById("mediaInput"),
  insertAfterButton: document.getElementById("insertAfterButton"),
  insertBeforeButton: document.getElementById("insertBeforeButton"),
  lengthTime: document.getElementById("lengthTime"),
  modalActions: document.getElementById("modalActions"),
  modalMessage: document.getElementById("modalMessage"),
  modalTitle: document.getElementById("modalTitle"),
  mobileExportButton: document.getElementById("mobileExportButton"),
  mobileExportMenu: document.getElementById("mobileExportMenu"),
  mobileExportSrtOption: document.getElementById("mobileExportSrtOption"),
  mobileExportVttOption: document.getElementById("mobileExportVttOption"),
  mobileHelpToggle: document.getElementById("mobileHelpToggle"),
  mobileMediaLabel: document.getElementById("mobileMediaLabel"),
  mobileSubtitleLabel: document.getElementById("mobileSubtitleLabel"),
  nextWindowButton: document.getElementById("nextWindowButton"),
  overviewBar: document.getElementById("overviewBar"),
  overviewWindow: document.getElementById("overviewWindow"),
  prevWindowButton: document.getElementById("prevWindowButton"),
  rows: document.getElementById("subtitleRows"),
  startTime: document.getElementById("startTime"),
  statusText: document.getElementById("statusText"),
  steadyCaret: document.getElementById("steadyCaret"),
  subtitleInput: document.getElementById("subtitleInput"),
  subtitleText: document.getElementById("subtitleText"),
  tableWrap: document.querySelector(".table-wrap"),
  toolsButton: document.getElementById("toolsButton"),
  toolsMenu: document.getElementById("toolsMenu"),
  wrapTextToggle: document.getElementById("wrapTextToggle"),
  video: document.getElementById("videoPlayer"),
  videoResizer: document.getElementById("videoResizer"),
  zoomInButton: document.getElementById("zoomInButton"),
  zoomOutButton: document.getElementById("zoomOutButton"),
};

// Central editor state. Times are stored in milliseconds so media, waveform, and subtitle files share one unit.
const state = {
  activeRowId: null,
  audioContext: null,
  durationMs: 0,
  draggingOverview: false,
  overviewDragOffsetMs: 0,
  dragTarget: null,
  mediaUrl: "",
  mediaName: "",
  mediaIsVideo: false,
  videoHidden: false,
  resizingVideoLayout: false,
  peaks: [],
  playheadMs: 0,
  rows: [],
  selectionEndMs: null,
  selectionStartMs: null,
  stopAtMs: null,
  undoStack: [],
  viewDurationMs: 15000,
  viewStartMs: 0,
  wheelGestureMode: null,
  wheelGestureTimer: null,
  wheelZoomDelta: 0,
  redoStack: [],
  autosaveTimer: null,
  draftDirty: false,
  isRestoring: false,
};

const ctx = els.canvas.getContext("2d");
const DRAFT_DB_NAME = "manual-subtitle-editor";
const DRAFT_STORE_NAME = "drafts";
const CURRENT_DRAFT_KEY = "current";
const HISTORY_LIMIT = 60;
const SNAP_TO_PREVIOUS_END_MS = 250;
const WHEEL_ZOOM_THRESHOLD = 55;

// Media helpers keep video and audio-style playback paths interchangeable.
function activeMedia() {
  return state.mediaIsVideo && !state.videoHidden ? els.video : els.audio;
}

function syncMediaTime(from, to) {
  if (!from.src || !to.src || !Number.isFinite(from.currentTime)) return;
  to.currentTime = Math.min(to.duration || from.currentTime, from.currentTime);
  to.volume = from.volume;
  to.muted = from.muted;
}

function updateMediaLayout() {
  const showVideo = state.mediaIsVideo && !state.videoHidden;
  els.editorGrid.classList.toggle("video-layout", showVideo);

  if (state.mediaIsVideo) {
    els.video.style.display = showVideo ? "block" : "none";
    els.audio.style.display = showVideo ? "none" : "block";
  }

  resizeCanvas();
}

function setVideoColumnWidthFromPointer(event) {
  const rect = els.editorGrid.getBoundingClientRect();
  const rawPercent = ((event.clientX - rect.left) / Math.max(1, rect.width)) * 100;
  const clampedPercent = Math.min(55, Math.max(24, rawPercent));
  els.editorGrid.style.setProperty("--video-column-width", `${clampedPercent.toFixed(1)}%`);
  resizeCanvas();
}

function waveformVolumeScale() {
  const media = activeMedia();
  if (!media.src) return 1;
  const audibleVolume = media.muted ? 0 : media.volume;
  return 0.18 + audibleVolume * 0.82;
}

function setStatus(message) {
  els.statusText.textContent = message;
}

function showModal({ title, message, actions }) {
  return new Promise((resolve) => {
    els.modalTitle.textContent = title;
    els.modalMessage.textContent = message;
    els.modalActions.innerHTML = "";

    actions.forEach((action) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = action.label;
      button.className = action.primary ? "primary" : "secondary";
      button.addEventListener("click", () => {
        els.appModal.hidden = true;
        resolve(action.value);
      });
      els.modalActions.appendChild(button);
    });

    els.appModal.hidden = false;
    els.modalActions.querySelector("button")?.focus();
  });
}

function closeExportMenu() {
  els.exportMenu.hidden = true;
  els.exportButton.setAttribute("aria-expanded", "false");
  els.mobileExportMenu.hidden = true;
  els.mobileExportButton.setAttribute("aria-expanded", "false");
}

function toggleExportMenu() {
  const willOpen = els.exportMenu.hidden;
  closeToolsMenu();
  els.exportMenu.hidden = !willOpen;
  els.exportButton.setAttribute("aria-expanded", String(willOpen));
}

function toggleMobileExportMenu() {
  const willOpen = els.mobileExportMenu.hidden;
  els.mobileExportMenu.hidden = !willOpen;
  els.mobileExportButton.setAttribute("aria-expanded", String(willOpen));
}

function closeToolsMenu() {
  els.toolsMenu.hidden = true;
  els.toolsButton.setAttribute("aria-expanded", "false");
  els.mobileExportMenu.hidden = true;
  els.mobileExportButton.setAttribute("aria-expanded", "false");
}

function toggleToolsMenu() {
  const willOpen = els.toolsMenu.hidden;
  closeExportMenu();
  els.toolsMenu.hidden = !willOpen;
  els.toolsButton.setAttribute("aria-expanded", String(willOpen));
}

function toggleHelpPanel() {
  const willOpen = els.helpPanel.hidden;
  els.helpPanel.hidden = !willOpen;
  els.helpToggle.setAttribute("aria-expanded", String(willOpen));
  els.mobileHelpToggle.setAttribute("aria-expanded", String(willOpen));
}

function updateSteadyCaret() {
  if (document.activeElement !== els.subtitleText) {
    els.steadyCaret.style.display = "none";
    return;
  }

  const textarea = els.subtitleText;
  const style = getComputedStyle(textarea);
  const wrapperRect = textarea.parentElement.getBoundingClientRect();
  const textareaRect = textarea.getBoundingClientRect();
  const mirror = document.createElement("div");
  const marker = document.createElement("span");
  const beforeCaret = textarea.value.slice(0, textarea.selectionStart);

  // Mirror the textarea content up to the selection point so the custom caret follows wrapped lines.
  mirror.style.position = "absolute";
  mirror.style.visibility = "hidden";
  mirror.style.whiteSpace = "pre-wrap";
  mirror.style.wordBreak = "break-word";
  mirror.style.overflowWrap = "break-word";
  mirror.style.width = `${textarea.clientWidth}px`;
  mirror.style.font = style.font;
  mirror.style.lineHeight = style.lineHeight;
  mirror.style.letterSpacing = style.letterSpacing;
  mirror.style.padding = style.padding;
  mirror.style.border = style.border;
  mirror.style.boxSizing = style.boxSizing;
  mirror.textContent = beforeCaret || "";
  marker.textContent = "\u200b";
  mirror.appendChild(marker);
  document.body.appendChild(mirror);

  const markerRect = marker.getBoundingClientRect();
  const mirrorRect = mirror.getBoundingClientRect();
  const left = textareaRect.left - wrapperRect.left + markerRect.left - mirrorRect.left - textarea.scrollLeft;
  const top = textareaRect.top - wrapperRect.top + markerRect.top - mirrorRect.top - textarea.scrollTop;

  els.steadyCaret.style.left = `${left}px`;
  els.steadyCaret.style.top = `${top}px`;
  els.steadyCaret.style.height = style.lineHeight === "normal" ? "20px" : style.lineHeight;
  els.steadyCaret.style.display = "block";
  mirror.remove();
}

// IndexedDB persistence stores the current local draft without requiring a server or download.
function openDraftDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DRAFT_DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(DRAFT_STORE_NAME, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function writeDraftRecord(record) {
  const db = await openDraftDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DRAFT_STORE_NAME, "readwrite");
    tx.objectStore(DRAFT_STORE_NAME).put(record);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

async function readDraftRecord() {
  const db = await openDraftDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DRAFT_STORE_NAME, "readonly");
    const request = tx.objectStore(DRAFT_STORE_NAME).get(CURRENT_DRAFT_KEY);
    request.onsuccess = () => resolve(request.result || null);
    tx.oncomplete = () => db.close();
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

// Snapshots are shared by autosave and undo/redo so UI state restores as a single unit.
function editorSnapshot() {
  return {
    activeRowId: state.activeRowId,
    durationMs: state.durationMs,
    rows: state.rows.map((row) => ({ ...row })),
    selectionEndMs: state.selectionEndMs,
    selectionStartMs: state.selectionStartMs,
    subtitleText: els.subtitleText.value,
    viewDurationMs: state.viewDurationMs,
    viewStartMs: state.viewStartMs,
  };
}

function applyEditorSnapshot(snapshot) {
  state.activeRowId = snapshot.activeRowId || null;
  state.durationMs = snapshot.durationMs || 0;
  state.rows = (snapshot.rows || []).map((row) => ({ ...row }));
  state.selectionEndMs = Number.isFinite(snapshot.selectionEndMs) ? snapshot.selectionEndMs : null;
  state.selectionStartMs = Number.isFinite(snapshot.selectionStartMs) ? snapshot.selectionStartMs : null;
  state.viewDurationMs = snapshot.viewDurationMs || Math.min(15000, Math.max(1000, state.durationMs || 15000));
  state.viewStartMs = snapshot.viewStartMs || 0;
  els.subtitleText.value = snapshot.subtitleText || "";
  updateSteadyCaret();
  clampViewStart();
  updateReadout();
  renderRows();
  draw();
}

function pushHistory() {
  // Restoring a snapshot should not create a second history entry for the same state.
  if (state.isRestoring) return;
  state.undoStack.push(editorSnapshot());
  if (state.undoStack.length > HISTORY_LIMIT) state.undoStack.shift();
  state.redoStack = [];
}

function undo() {
  if (!state.undoStack.length) return;
  state.redoStack.push(editorSnapshot());
  const snapshot = state.undoStack.pop();
  state.isRestoring = true;
  applyEditorSnapshot(snapshot);
  state.isRestoring = false;
  scheduleAutosave();
}

function redo() {
  if (!state.redoStack.length) return;
  state.undoStack.push(editorSnapshot());
  const snapshot = state.redoStack.pop();
  state.isRestoring = true;
  applyEditorSnapshot(snapshot);
  state.isRestoring = false;
  scheduleAutosave();
}

function draftRecord() {
  return {
    id: CURRENT_DRAFT_KEY,
    updatedAt: Date.now(),
    snapshot: editorSnapshot(),
  };
}

async function saveDraft({ manual = false } = {}) {
  try {
    await writeDraftRecord(draftRecord());
    state.draftDirty = false;
    if (manual) setStatus("Draft saved locally.");
  } catch (error) {
    setStatus("Local draft save failed.");
  }
}

function scheduleAutosave() {
  if (state.isRestoring) return;
  state.draftDirty = true;
  clearTimeout(state.autosaveTimer);
  state.autosaveTimer = setTimeout(() => {
    saveDraft();
  }, 350);
}

function hasActiveWork() {
  return state.rows.length > 0 || els.subtitleText.value.trim() !== "" || Boolean(state.mediaUrl);
}

function warnBeforeRefresh(event) {
  if (!hasActiveWork()) return;
  if (state.draftDirty) saveDraft();
  event.preventDefault();
  event.returnValue = "";
}

async function restoreDraft() {
  try {
    const record = await readDraftRecord();
    if (!record?.snapshot) return;
    state.isRestoring = true;
    applyEditorSnapshot(record.snapshot);
    state.isRestoring = false;
    if (state.rows.length || els.subtitleText.value) {
      setStatus("Draft restored. Reselect media if you need playback or waveform audio.");
    }
  } catch (error) {
    state.isRestoring = false;
  }
}

// Time formatting and parsing utilities bridge UI display, SRT, and VTT timestamp formats.
function formatShortTime(ms) {
  if (!Number.isFinite(ms)) return "--:--.---";
  const safeMs = Math.max(0, Math.round(ms));
  const seconds = safeMs / 1000;
  return `${seconds.toFixed(2)}s`;
}

function formatTableTime(ms) {
  const safeMs = Math.max(0, Math.round(ms));
  const hours = Math.floor(safeMs / 3600000);
  const minutes = Math.floor((safeMs % 3600000) / 60000);
  const seconds = Math.floor((safeMs % 60000) / 1000);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatSubtitleTimestamp(ms, separator = ",") {
  const safeMs = Math.max(0, Math.round(ms));
  const hours = Math.floor(safeMs / 3600000);
  const minutes = Math.floor((safeMs % 3600000) / 60000);
  const seconds = Math.floor((safeMs % 60000) / 1000);
  const milliseconds = safeMs % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}${separator}${String(milliseconds).padStart(3, "0")}`;
}

function parseSubtitleTimestamp(value) {
  const cleanValue = value.trim().replace(",", ".");
  const parts = cleanValue.split(":");
  if (parts.length < 2 || parts.length > 3) return null;

  const secondsPart = parts.pop();
  const secondsMatch = secondsPart.match(/^(\d{1,2})(?:\.(\d{1,3}))?$/);
  if (!secondsMatch) return null;

  const seconds = Number(secondsMatch[1]);
  const milliseconds = Number((secondsMatch[2] || "0").padEnd(3, "0"));
  const minutes = Number(parts.pop());
  const hours = parts.length ? Number(parts.pop()) : 0;

  if (![hours, minutes, seconds, milliseconds].every(Number.isFinite)) return null;
  return hours * 3600000 + minutes * 60000 + seconds * 1000 + milliseconds;
}

function subtitleFileBaseName() {
  const sourceName = state.mediaName || "subtitles";
  return sourceName.replace(/\.[^.]+$/, "") || "subtitles";
}

// Waveform viewport math converts between media time and canvas coordinates.
function canvasSize() {
  const rect = els.canvas.getBoundingClientRect();
  return { width: rect.width, height: rect.height };
}

function resizeCanvas() {
  const { width, height } = canvasSize();
  const ratio = window.devicePixelRatio || 1;
  els.canvas.width = Math.max(1, Math.floor(width * ratio));
  els.canvas.height = Math.max(1, Math.floor(height * ratio));
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  draw();
}

function msToX(ms) {
  if (!state.durationMs) return 0;
  return ((ms - state.viewStartMs) / state.viewDurationMs) * canvasSize().width;
}

function xToMs(x) {
  if (!state.durationMs) return 0;
  return Math.round(state.viewStartMs + (x / canvasSize().width) * state.viewDurationMs);
}

function normalizedSelection() {
  if (state.selectionStartMs === null || state.selectionEndMs === null) return null;
  return {
    start: Math.min(state.selectionStartMs, state.selectionEndMs),
    end: Math.max(state.selectionStartMs, state.selectionEndMs),
  };
}

function updateReadout() {
  const selection = normalizedSelection();
  els.startTime.textContent = selection ? formatShortTime(selection.start) : formatShortTime(state.selectionStartMs);
  els.endTime.textContent = selection ? formatShortTime(selection.end) : formatShortTime(state.selectionEndMs);
  els.lengthTime.textContent = selection ? formatShortTime(selection.end - selection.start) : "--:--.---";
  updateWindowButtons();
  updateOverview();
}

function clampViewStart() {
  const maxStart = Math.max(0, state.durationMs - state.viewDurationMs);
  state.viewStartMs = Math.min(maxStart, Math.max(0, state.viewStartMs));
}

function setViewAround(ms) {
  if (!state.durationMs) return;
  state.viewStartMs = Math.max(0, Math.round(ms - state.viewDurationMs * 0.15));
  clampViewStart();
}

function updateWindowButtons() {
  const hasMedia = state.durationMs > 0;
  els.prevWindowButton.disabled = !hasMedia || state.viewStartMs <= 0;
  els.nextWindowButton.disabled = !hasMedia || state.viewStartMs + state.viewDurationMs >= state.durationMs;
  els.zoomInButton.disabled = !hasMedia || state.viewDurationMs <= 3000;
  els.zoomOutButton.disabled = !hasMedia || state.viewDurationMs >= state.durationMs;
}

function zoomWaveform(direction, anchorMs = state.viewStartMs + state.viewDurationMs / 2) {
  if (!state.durationMs) return;
  const oldDuration = state.viewDurationMs;
  const zoomFactor = direction === "in" ? 0.82 : 1.22;
  const nextDuration = Math.min(state.durationMs, Math.max(3000, Math.round(oldDuration * zoomFactor)));
  const anchorRatio = (anchorMs - state.viewStartMs) / oldDuration;
  state.viewDurationMs = nextDuration;
  state.viewStartMs = Math.round(anchorMs - nextDuration * anchorRatio);
  clampViewStart();
  updateReadout();
  draw();
  scheduleAutosave();
}

function panWaveform(deltaX) {
  if (!state.durationMs) return;
  const { width } = canvasSize();
  const moveMs = Math.round((deltaX / Math.max(1, width)) * state.viewDurationMs);
  state.viewStartMs += moveMs;
  clampViewStart();
  updateReadout();
  draw();
  scheduleAutosave();
}

function moveWaveformWindow(direction) {
  if (!state.durationMs) return;
  state.viewStartMs += direction * state.viewDurationMs;
  clampViewStart();
  updateReadout();
  draw();
  scheduleAutosave();
}

function updateOverview() {
  if (!state.durationMs) {
    els.overviewWindow.style.width = "0";
    els.overviewWindow.style.left = "0";
    return;
  }

  const startPercent = (state.viewStartMs / state.durationMs) * 100;
  const widthPercent = Math.min(100, (state.viewDurationMs / state.durationMs) * 100);
  els.overviewWindow.style.left = `${startPercent}%`;
  els.overviewWindow.style.width = `${widthPercent}%`;
}

function setOverviewFromPointer(event) {
  if (!state.durationMs) return;
  const rect = els.overviewBar.getBoundingClientRect();
  const x = Math.min(rect.width, Math.max(0, event.clientX - rect.left));
  const centerMs = (x / Math.max(1, rect.width)) * state.durationMs;
  state.viewStartMs = Math.round(centerMs - state.overviewDragOffsetMs);
  clampViewStart();
  updateReadout();
  draw();
  scheduleAutosave();
}

function classifyWheelGesture(event) {
  if (event.ctrlKey) return "zoom";
  if (Math.abs(event.deltaX) > Math.abs(event.deltaY) * 1.2) return "pan";
  return null;
}

function handleWaveformWheel(event) {
  if (!state.durationMs) return;
  event.preventDefault();

  // Keep one gesture mode for a short burst so trackpad scroll does not flicker between pan and zoom.
  if (!state.wheelGestureMode) {
    state.wheelGestureMode = classifyWheelGesture(event);
  }

  clearTimeout(state.wheelGestureTimer);
  state.wheelGestureTimer = setTimeout(() => {
    state.wheelGestureMode = null;
    state.wheelZoomDelta = 0;
  }, 180);

  if (state.wheelGestureMode === "zoom") {
    const delta = event.deltaY || event.deltaX;
    state.wheelZoomDelta += delta;
    if (Math.abs(state.wheelZoomDelta) >= WHEEL_ZOOM_THRESHOLD) {
      zoomWaveform(state.wheelZoomDelta < 0 ? "in" : "out", pointerMs(event));
      state.wheelZoomDelta = 0;
    }
    return;
  }

  if (state.wheelGestureMode === "pan" && event.deltaX !== 0) {
    panWaveform(event.deltaX);
  }
}

// Canvas drawing helpers render markers, saved rows, the active selection, and playback position.
function drawMarker(x, color, width = 3) {
  const { height } = canvasSize();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x, 0);
  ctx.lineTo(x, height);
  ctx.stroke();
}

function drawBoundaryHandle(x, color, side = "start") {
  const { height } = canvasSize();
  const triangle = 8;
  drawMarker(x, color, 3);
  ctx.fillStyle = color;
  ctx.beginPath();
  if (side === "start") {
    ctx.moveTo(x, 0);
    ctx.lineTo(x + triangle, 0);
    ctx.lineTo(x, triangle);
  } else {
    ctx.moveTo(x, 0);
    ctx.lineTo(x - triangle, 0);
    ctx.lineTo(x, triangle);
  }
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  if (side === "start") {
    ctx.moveTo(x, height);
    ctx.lineTo(x + triangle, height);
    ctx.lineTo(x, height - triangle);
  } else {
    ctx.moveTo(x, height);
    ctx.lineTo(x - triangle, height);
    ctx.lineTo(x, height - triangle);
  }
  ctx.closePath();
  ctx.fill();
}

function overlappingRowIds() {
  return overlappingIdsForRows(state.rows);
}

function overlappingIdsForRows(rows) {
  const sortedRows = [...rows].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  const overlaps = new Set();
  let widestPrevious = sortedRows[0];

  // Sweep by start time while keeping the previous row with the farthest end to catch nested overlaps.
  for (let index = 1; index < sortedRows.length; index += 1) {
    const current = sortedRows[index];
    if (widestPrevious && current.startMs < widestPrevious.endMs) {
      overlaps.add(widestPrevious.id);
      overlaps.add(current.id);
    }
    if (!widestPrevious || current.endMs > widestPrevious.endMs) widestPrevious = current;
  }
  return overlaps;
}

function drawableSavedRows() {
  if (!state.activeRowId) return state.rows;
  return state.rows.filter((row) => row.id !== state.activeRowId);
}

function draw() {
  const { width, height } = canvasSize();
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#e6e0d5";
  ctx.fillRect(0, 0, width, height);

  if (!state.peaks.length) {
    ctx.fillStyle = "#7a746b";
    ctx.font = "16px system-ui, sans-serif";
    ctx.fillText("Waveform appears here after upload.", 24, 38);
    return;
  }

  const middle = height / 2;
  const visibleStart = state.viewStartMs;
  const visibleEnd = Math.min(state.durationMs, state.viewStartMs + state.viewDurationMs);
  const desiredBars = Math.max(40, Math.floor(width / 8));
  const barWidth = Math.max(2, width / desiredBars);
  const peakMs = state.durationMs / state.peaks.length;
  const volumeScale = waveformVolumeScale();

  ctx.strokeStyle = "#7f8e78";
  ctx.lineWidth = Math.min(4, Math.max(2, barWidth * 0.45));
  ctx.lineCap = "round";
  for (let bar = 0; bar < desiredBars; bar += 1) {
    const barStartMs = visibleStart + (bar / desiredBars) * (visibleEnd - visibleStart);
    const barEndMs = visibleStart + ((bar + 1) / desiredBars) * (visibleEnd - visibleStart);
    const startIndex = Math.max(0, Math.floor(barStartMs / peakMs));
    const endIndex = Math.min(state.peaks.length - 1, Math.ceil(barEndMs / peakMs));
    let peak = 0;
    for (let index = startIndex; index <= endIndex; index += 1) {
      peak = Math.max(peak, state.peaks[index] || 0);
    }
    const x = bar * barWidth + barWidth / 2;
    const barHeight = Math.max(8, peak * (height - 44) * volumeScale);
    ctx.beginPath();
    ctx.moveTo(x, middle - barHeight / 2);
    ctx.lineTo(x, middle + barHeight / 2);
    ctx.stroke();
  }

  const savedRows = drawableSavedRows();
  const overlaps = overlappingIdsForRows(savedRows);
  savedRows.forEach((row) => {
    const hasOverlap = overlaps.has(row.id);
    const fillColor = hasOverlap ? "rgba(164, 96, 88, 0.24)" : "rgba(126, 141, 120, 0.2)";
    const handleColor = hasOverlap ? "#a46058" : "#7f8d78";
    const rowStartX = msToX(row.startMs);
    const rowEndX = msToX(row.endMs);
    const visibleRowStart = Math.max(0, rowStartX);
    const visibleRowEnd = Math.min(width, rowEndX);
    if (visibleRowEnd > visibleRowStart) {
      ctx.fillStyle = fillColor;
      ctx.fillRect(visibleRowStart, 0, visibleRowEnd - visibleRowStart, height);
    }
    if (rowStartX >= 0 && rowStartX <= width) drawBoundaryHandle(rowStartX, handleColor, "start");
    if (rowEndX >= 0 && rowEndX <= width) drawBoundaryHandle(rowEndX, handleColor, "end");
  });

  const selection = normalizedSelection();
  if (selection) {
    const startX = msToX(selection.start);
    const endX = msToX(selection.end);
    const visibleSelectionStart = Math.max(0, startX);
    const visibleSelectionEnd = Math.min(width, endX);
    if (visibleSelectionEnd > visibleSelectionStart) {
      ctx.fillStyle = "rgba(176, 154, 108, 0.28)";
      ctx.fillRect(visibleSelectionStart, 0, visibleSelectionEnd - visibleSelectionStart, height);
    }
    if (startX >= 0 && startX <= width) drawBoundaryHandle(startX, "#a8836e", "start");
    if (endX >= 0 && endX <= width) drawBoundaryHandle(endX, "#b7a064", "end");
  } else {
    const startX = msToX(state.selectionStartMs);
    const endX = msToX(state.selectionEndMs);
    if (state.selectionStartMs !== null && startX >= 0 && startX <= width) drawBoundaryHandle(startX, "#a8836e", "start");
    if (state.selectionEndMs !== null && endX >= 0 && endX <= width) drawBoundaryHandle(endX, "#b7a064", "end");
  }

  const playheadX = msToX(state.playheadMs);
  if (state.playheadMs > 0 && playheadX >= 0 && playheadX <= width) {
    drawMarker(playheadX, "#27c274", 3);
  }

  ctx.fillStyle = "rgba(255, 253, 248, 0.84)";
  ctx.fillRect(12, 12, 172, 30);
  ctx.fillStyle = "#5d554b";
  ctx.font = "14px system-ui, sans-serif";
  ctx.fillText(`${formatShortTime(visibleStart)} - ${formatShortTime(visibleEnd)}`, 22, 32);
}

function computePeaks(audioBuffer) {
  const desiredBars = Math.min(120000, Math.max(160, Math.ceil(audioBuffer.duration * 12)));
  const channels = [];
  for (let channel = 0; channel < audioBuffer.numberOfChannels; channel += 1) {
    channels.push(audioBuffer.getChannelData(channel));
  }

  const blockSize = Math.max(1, Math.floor(audioBuffer.length / desiredBars));
  const peaks = [];
  let highest = 0;

  // Reduce raw samples into normalized peak buckets so long media can be drawn quickly.
  for (let block = 0; block < desiredBars; block += 1) {
    const start = block * blockSize;
    const end = Math.min(audioBuffer.length, start + blockSize);
    let peak = 0;
    for (const data of channels) {
      for (let index = start; index < end; index += 1) {
        peak = Math.max(peak, Math.abs(data[index] || 0));
      }
    }
    highest = Math.max(highest, peak);
    peaks.push(peak);
  }

  return highest > 0 ? peaks.map((peak) => peak / highest) : peaks;
}

async function decodeWaveform(file) {
  state.audioContext ||= new AudioContext();
  const arrayBuffer = await file.arrayBuffer();
  const audioBuffer = await state.audioContext.decodeAudioData(arrayBuffer);
  state.durationMs = Math.round(audioBuffer.duration * 1000);
  state.peaks = computePeaks(audioBuffer);
}

// Subtitle import/export supports standard SRT timing and basic WEBVTT cues.
function parseSubtitleFile(text) {
  const normalizedText = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim();
  // Drop WEBVTT headers and metadata before splitting cue blocks.
  const withoutHeader = normalizedText.replace(/^WEBVTT[^\n]*(?:\n[^\n]*)*?\n\n/i, "");
  const blocks = withoutHeader.split(/\n{2,}/);

  return blocks.flatMap((block) => {
    const lines = block.split("\n").map((line) => line.trimEnd()).filter((line) => line.trim() !== "");
    const timingLineIndex = lines.findIndex((line) => line.includes("-->"));
    if (timingLineIndex === -1) return [];

    const [startPart, endPart] = lines[timingLineIndex].split("-->").map((part) => part.trim().split(/\s+/)[0]);
    const startMs = parseSubtitleTimestamp(startPart);
    const endMs = parseSubtitleTimestamp(endPart);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return [];

    return [{
      id: crypto.randomUUID(),
      startMs,
      endMs,
      text: lines.slice(timingLineIndex + 1).join("\n"),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }];
  }).sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
}

function buildSrt(rows) {
  return rows.map((row, index) => [
    index + 1,
    `${formatSubtitleTimestamp(row.startMs, ",")} --> ${formatSubtitleTimestamp(row.endMs, ",")}`,
    row.text,
  ].join("\n")).join("\n\n");
}

function buildVtt(rows) {
  const cues = rows.map((row) => [
    `${formatSubtitleTimestamp(row.startMs, ".")} --> ${formatSubtitleTimestamp(row.endMs, ".")}`,
    row.text,
  ].join("\n")).join("\n\n");
  return `WEBVTT\n\n${cues}`;
}

function downloadTextFile(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function exportSubtitles(format) {
  const rows = [...state.rows].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  if (!rows.length) {
    setStatus("No saved subtitle rows to export yet.");
    return;
  }

  if (format === "vtt") {
    downloadTextFile(buildVtt(rows), `${subtitleFileBaseName()}.vtt`, "text/vtt;charset=utf-8");
    setStatus("VTT subtitle file exported.");
    return;
  }

  downloadTextFile(buildSrt(rows), `${subtitleFileBaseName()}.srt`, "application/x-subrip;charset=utf-8");
  setStatus("SRT subtitle file exported.");
}

async function importSubtitles(file) {
  if (!file) return;
  const text = await file.text();
  const rows = parseSubtitleFile(text);
  if (!rows.length) {
    setStatus("No subtitle rows found. Try an .srt or .vtt file.");
    return;
  }

  if (state.rows.length && !window.confirm("Replace current subtitle rows with the imported file?")) {
    els.subtitleInput.value = "";
    return;
  }

  pushHistory();
  state.rows = rows;
  state.activeRowId = null;
  els.subtitleText.value = "";
  const lastEnd = rows.at(-1).endMs;
  if (state.durationMs) setDefaultSelection(lastEnd);
  updateSteadyCaret();
  updateReadout();
  renderRows();
  draw();
  scheduleAutosave();
  setStatus(`Imported ${rows.length} subtitle row${rows.length === 1 ? "" : "s"}.`);
  els.subtitleInput.value = "";
}

// Media loading owns object URLs, waveform decoding, and video/audio layout choice.
function resetCurrentDraft() {
  state.activeRowId = null;
  state.selectionStartMs = null;
  state.selectionEndMs = null;
  els.subtitleText.value = "";
  updateSteadyCaret();
  updateReadout();
  renderRows();
  draw();
}

function updateRowToolState() {
  const hasActiveRow = Boolean(state.activeRowId);
  els.insertBeforeButton.disabled = !hasActiveRow;
  els.insertAfterButton.disabled = !hasActiveRow;
}

function commitActiveRowDraft() {
  if (!state.activeRowId) return;
  const row = state.rows.find((item) => item.id === state.activeRowId);
  const selection = normalizedSelection();
  if (!row) return;
  if (selection) {
    row.startMs = selection.start;
    row.endMs = selection.end;
  }
  row.text = els.subtitleText.value;
  row.updatedAt = Date.now();
  state.rows.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
}

function activeRowIndex() {
  return state.rows.findIndex((row) => row.id === state.activeRowId);
}

function setDefaultSelection(startMs = 0) {
  const start = Math.min(Math.max(0, startMs), Math.max(0, state.durationMs - 1));
  const end = Math.min(state.durationMs, start + 5000);
  state.selectionStartMs = start;
  state.selectionEndMs = end > start ? end : null;
  setViewAround(start);
}

async function confirmMediaReplacementIfNeeded() {
  if (!state.rows.length) return true;

  const choice = await showModal({
    title: "Saved subtitles already exist",
    message: "Loading a new media file will clear the current subtitle rows because their timing may not match the new media. Export first if you want to keep them.",
    actions: [
      { label: "Continue and clear", value: "continue", primary: true },
      { label: "Cancel", value: "cancel" },
    ],
  });

  if (choice === "continue") {
    pushHistory();
    state.rows = [];
    state.activeRowId = null;
    els.subtitleText.value = "";
    renderRows();
    scheduleAutosave();
    return true;
  }

  return false;
}

async function chooseVideoDisplayMode() {
  const choice = await showModal({
    title: "How do you want to load this video?",
    message: "Video layout shows the video beside the waveform and text box. Audio-style layout hides the video and keeps the simpler vertical editor.",
    actions: [
      { label: "Load as Video", value: "video", primary: true },
      { label: "Load as Audio-style", value: "audio" },
      { label: "Cancel", value: "cancel" },
    ],
  });

  return choice;
}

async function loadMedia(file) {
  if (!file || (!file.type.startsWith("audio/") && !file.type.startsWith("video/"))) {
    setStatus("Please choose an audio or video file.");
    return false;
  }

  const canReplace = await confirmMediaReplacementIfNeeded();
  if (!canReplace) return false;

  const isVideoFile = file.type.startsWith("video/");
  if (isVideoFile) {
    const videoChoice = await chooseVideoDisplayMode();
    if (videoChoice === "cancel") return false;
    state.videoHidden = videoChoice === "audio";
  } else {
    state.videoHidden = false;
  }

  if (state.mediaUrl) URL.revokeObjectURL(state.mediaUrl);
  state.mediaUrl = URL.createObjectURL(file);
  state.mediaName = file.name || "";
  state.mediaIsVideo = isVideoFile;
  state.durationMs = 0;
  state.peaks = [];
  state.playheadMs = 0;
  state.viewDurationMs = 15000;
  state.viewStartMs = 0;
  resetCurrentDraft();
  draw();

  els.emptyPreview.style.display = "none";
  els.audio.pause();
  els.video.pause();
  els.audio.removeAttribute("src");
  els.video.removeAttribute("src");

  if (state.mediaIsVideo) {
    els.video.src = state.mediaUrl;
    els.audio.src = state.mediaUrl;
  } else {
    els.audio.src = state.mediaUrl;
    els.audio.style.display = "block";
    els.video.style.display = "none";
  }

  updateMediaLayout();

  setStatus("Reading audio so the waveform can be drawn...");

  try {
    await decodeWaveform(file);
    state.viewDurationMs = Math.min(15000, Math.max(1000, state.durationMs));
    setDefaultSelection(0);
    setStatus("");
  } catch (error) {
    state.peaks = [];
    setStatus("The media loaded, but this browser could not decode the waveform. Try MP3, WAV, MP4, or WebM.");
  }

  const media = activeMedia();
  media.onloadedmetadata = () => {
    if (!state.durationMs && Number.isFinite(media.duration)) {
      state.durationMs = Math.round(media.duration * 1000);
      state.viewDurationMs = Math.min(15000, Math.max(1000, state.durationMs));
      setDefaultSelection(0);
      updateReadout();
      renderRows();
    }
  };

  updateReadout();
  renderRows();
  draw();
  scheduleAutosave();
  return true;
}

function pointerMs(event) {
  const rect = els.canvas.getBoundingClientRect();
  return Math.min(state.durationMs, Math.max(0, xToMs(event.clientX - rect.left)));
}

// Pointer interactions edit selections and saved-row boundaries directly on the waveform.
function snapStartToPreviousEnd(ms) {
  const candidates = state.rows.filter((row) => row.id !== state.activeRowId);
  let nearestEnd = ms;
  let nearestDistance = SNAP_TO_PREVIOUS_END_MS + 1;

  candidates.forEach((row) => {
    const distance = Math.abs(row.endMs - ms);
    if (distance <= SNAP_TO_PREVIOUS_END_MS && distance < nearestDistance) {
      nearestEnd = row.endMs;
      nearestDistance = distance;
    }
  });

  return nearestEnd;
}

function updatePlaybackStopFromSelection() {
  const media = activeMedia();
  const selection = normalizedSelection();
  if (state.stopAtMs === null || !selection) return;
  state.stopAtMs = selection.end;
  if (!media.paused && media.currentTime * 1000 >= state.stopAtMs) {
    media.pause();
    media.currentTime = state.stopAtMs / 1000;
    state.playheadMs = state.stopAtMs;
    state.stopAtMs = null;
  }
}

function nearestMarker(event) {
  const selection = normalizedSelection();
  if (!selection) return null;
  const x = event.clientX - els.canvas.getBoundingClientRect().left;
  const startDistance = Math.abs(x - msToX(selection.start));
  const endDistance = Math.abs(x - msToX(selection.end));
  if (Math.min(startDistance, endDistance) > 14) return null;
  return startDistance <= endDistance ? "start" : "end";
}

function savedRowHit(event) {
  const { width } = canvasSize();
  const x = event.clientX - els.canvas.getBoundingClientRect().left;
  const markerThreshold = 14;
  const visibleRows = [...state.rows]
    .filter((row) => row.id !== state.activeRowId)
    .filter((row) => msToX(row.endMs) >= 0 && msToX(row.startMs) <= width)
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);

  let insideHit = null;
  let markerHit = null;
  let markerDistance = markerThreshold + 1;

  visibleRows.forEach((row) => {
    const startX = msToX(row.startMs);
    const endX = msToX(row.endMs);
    const startDistance = Math.abs(x - startX);
    const endDistance = Math.abs(x - endX);

    if (startDistance <= markerThreshold && startDistance < markerDistance) {
      markerHit = { row, marker: "start" };
      markerDistance = startDistance;
    }

    if (endDistance <= markerThreshold && endDistance < markerDistance) {
      markerHit = { row, marker: "end" };
      markerDistance = endDistance;
    }

    if (!insideHit && x >= Math.min(startX, endX) && x <= Math.max(startX, endX)) {
      insideHit = { row, marker: null };
    }
  });

  // Prefer marker hits over inside-row hits so dragging boundaries remains precise.
  return markerHit || insideHit;
}

function setSelectionFromPointer(event) {
  if (!state.durationMs) return;
  event.preventDefault();
  const ms = pointerMs(event);

  if (event.button === 2) {
    state.selectionEndMs = ms;
  } else if (event.button === 0) {
    const marker = nearestMarker(event);
    if (marker) {
      state.dragTarget = marker;
      els.canvas.setPointerCapture(event.pointerId);
      return;
    }

    const hit = savedRowHit(event);
    if (hit) {
      loadRow(hit.row.id);
      if (hit.marker) {
        state.dragTarget = hit.marker;
        els.canvas.setPointerCapture(event.pointerId);
      }
      return;
    }

    state.selectionStartMs = snapStartToPreviousEnd(ms);
  }

  updatePlaybackStopFromSelection();
  commitActiveRowDraft();
  updateReadout();
  renderRows();
  draw();
  scheduleAutosave();
}

function dragMarker(event) {
  if (!state.dragTarget || !state.durationMs) return;
  const ms = pointerMs(event);
  // Start markers snap to the previous subtitle end; end markers remain free for fine timing.
  if (state.dragTarget === "start") state.selectionStartMs = snapStartToPreviousEnd(ms);
  if (state.dragTarget === "end") state.selectionEndMs = ms;
  updatePlaybackStopFromSelection();
  commitActiveRowDraft();
  updateReadout();
  renderRows();
  draw();
  scheduleAutosave();
}

function stopDragging(event) {
  if (!state.dragTarget) return;
  state.dragTarget = null;
  try {
    els.canvas.releasePointerCapture(event.pointerId);
  } catch (error) {
    // Pointer capture can already be released by the browser; no user-facing action needed.
  }
}

// Playback helpers keep preview playback bounded by the selected subtitle range when needed.
function stopPlayback() {
  const media = activeMedia();
  media.pause();
  state.stopAtMs = null;
  state.playheadMs = Math.round(media.currentTime * 1000);
  draw();
}

async function replaySelection() {
  const selection = normalizedSelection();
  if (!selection || selection.end <= selection.start) {
    setStatus("Select a start and end time first.");
    return;
  }

  const media = activeMedia();
  if (!media.src) {
    setStatus("Upload media before replaying.");
    return;
  }

  state.stopAtMs = selection.end;
  media.currentTime = selection.start / 1000;
  await media.play();
  setStatus(`Replaying ${formatShortTime(selection.start)} to ${formatShortTime(selection.end)}.`);
  requestAnimationFrame(trackPlayhead);
}

async function togglePlayback() {
  const media = activeMedia();
  if (!media.src) return;
  if (!media.paused) {
    stopPlayback();
    return;
  }

  const selection = normalizedSelection();
  const currentMs = media.currentTime * 1000;
  if (selection && (currentMs < selection.start || currentMs >= selection.end)) {
    await replaySelection();
    return;
  }

  state.stopAtMs = selection ? selection.end : null;
  await media.play();
  requestAnimationFrame(trackPlayhead);
}

function trackPlayhead() {
  const media = activeMedia();
  state.playheadMs = Math.round(media.currentTime * 1000);

  if (state.stopAtMs !== null && state.playheadMs >= state.stopAtMs) {
    media.pause();
    media.currentTime = state.stopAtMs / 1000;
    state.playheadMs = state.stopAtMs;
    state.stopAtMs = null;
    setStatus("Replay finished at the selected end time.");
    draw();
    return;
  }

  draw();
  if (!media.paused) requestAnimationFrame(trackPlayhead);
}

// Subtitle row operations keep the table, active draft, waveform, history, and autosave in sync.
function saveSubtitle() {
  const selection = normalizedSelection();
  const text = els.subtitleText.value;
  if (!selection || selection.end <= selection.start) {
    setStatus("Choose a start and end time before saving.");
    return;
  }

  pushHistory();
  const now = Date.now();
  let savedRowId = state.activeRowId;
  if (state.activeRowId) {
    const row = state.rows.find((item) => item.id === state.activeRowId);
    if (row) {
      row.startMs = selection.start;
      row.endMs = selection.end;
      row.text = text;
      row.updatedAt = now;
      setStatus("Subtitle row updated.");
    }
  } else {
    savedRowId = crypto.randomUUID();
    state.rows.push({
      id: savedRowId,
      startMs: selection.start,
      endMs: selection.end,
      text,
      createdAt: now,
      updatedAt: now,
    });
  }

  state.rows.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  const currentIndex = state.rows.findIndex((row) => row.id === savedRowId);
  const nextRow = currentIndex >= 0 ? state.rows[currentIndex + 1] : null;
  if (nextRow) {
    loadRow(nextRow.id, { focusText: true, commitCurrent: false });
    setStatus("Saved. Loaded the next existing subtitle row.");
  } else {
    state.activeRowId = null;
    setDefaultSelection(selection.end);
    els.subtitleText.value = "";
    setStatus("Saved. New draft range is ready.");
  }
  updateSteadyCaret();
  updateReadout();
  renderRows();
  draw();
  els.subtitleText.focus();
  scheduleAutosave();
}

function addSubtitleRow(startMs, endMs, text = "") {
  const now = Date.now();
  const row = {
      id: crypto.randomUUID(),
      startMs,
      endMs,
      text,
      createdAt: now,
      updatedAt: now,
  };
  pushHistory();
  state.rows.push(row);
  state.rows.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  loadRow(row.id, { focusText: true, commitCurrent: false });
  scheduleAutosave();
  return row;
}

function loadRow(rowId, { focusText = false, commitCurrent = true } = {}) {
  if (commitCurrent && state.activeRowId && state.activeRowId !== rowId) {
    commitActiveRowDraft();
  }
  const row = state.rows.find((item) => item.id === rowId);
  if (!row) return;
  state.activeRowId = row.id;
  state.selectionStartMs = row.startMs;
  state.selectionEndMs = row.endMs;
  els.subtitleText.value = row.text;
  updateSteadyCaret();
  updateReadout();
  renderRows();
  draw();
  if (focusText) els.subtitleText.focus();
  setStatus("Loaded row for revision. Edit text or timing, then press Enter to save.");
  scheduleAutosave();
}

function deleteRow(rowId) {
  pushHistory();
  state.rows = state.rows.filter((row) => row.id !== rowId);
  if (state.activeRowId === rowId) resetCurrentDraft();
  else renderRows();
  scheduleAutosave();
}

function deleteActiveRow() {
  if (!state.activeRowId) return;
  deleteRow(state.activeRowId);
  setStatus("Selected subtitle row deleted.");
}

function insertRowBeforeCurrent() {
  if (!state.activeRowId) return;
  commitActiveRowDraft();
  const sortedRows = [...state.rows].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  const index = sortedRows.findIndex((row) => row.id === state.activeRowId);
  if (index === -1) return;
  const current = sortedRows[index];
  const previous = sortedRows[index - 1];
  const endMs = current.startMs;
  let startMs = previous ? previous.endMs : Math.max(0, endMs - 5000);
  if (endMs <= startMs) startMs = Math.max(0, endMs - 1000);
  addSubtitleRow(startMs, endMs);
  setStatus("Inserted a blank subtitle row before the selected row.");
}

function insertRowAfterCurrent() {
  if (!state.activeRowId) return;
  commitActiveRowDraft();
  const sortedRows = [...state.rows].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  const index = sortedRows.findIndex((row) => row.id === state.activeRowId);
  if (index === -1) return;
  const current = sortedRows[index];
  const next = sortedRows[index + 1];
  const startMs = current.endMs;
  let endMs = next ? next.startMs : startMs + 5000;
  if (state.durationMs) endMs = Math.min(state.durationMs, endMs);
  if (endMs <= startMs) endMs = state.durationMs ? Math.min(state.durationMs, startMs + 1000) : startMs + 1000;
  addSubtitleRow(startMs, endMs);
  setStatus("Inserted a blank subtitle row after the selected row.");
}

function toggleTableWrap() {
  els.tableWrap.classList.toggle("wrap-text", els.wrapTextToggle.checked);
  renderRows();
}

function displayRowsWithDraft() {
  const selection = normalizedSelection();
  const draftText = els.subtitleText.value;

  if (state.activeRowId) {
    return state.rows.map((row) => {
      if (row.id !== state.activeRowId) return { ...row, displayId: row.id };
      return {
        ...row,
        displayId: row.id,
        startMs: selection ? selection.start : row.startMs,
        endMs: selection ? selection.end : row.endMs,
        text: draftText,
        isEditing: true,
      };
    });
  }

  // Include the unsaved draft in the sorted table so users can see its timing before saving.
  return [
    ...state.rows.map((row) => ({ ...row, displayId: row.id })),
    {
      id: "draft-row",
      displayId: "draft-row",
      startMs: selection ? selection.start : null,
      endMs: selection ? selection.end : null,
      text: draftText,
      isDraft: true,
    },
  ].sort((a, b) => {
    const aStart = Number.isFinite(a.startMs) ? a.startMs : Number.POSITIVE_INFINITY;
    const bStart = Number.isFinite(b.startMs) ? b.startMs : Number.POSITIVE_INFINITY;
    return aStart - bStart || (a.endMs || 0) - (b.endMs || 0);
  });
}

function overlappingDisplayIds(rows) {
  const overlaps = new Set();
  const timedRows = rows
    .filter((row) => Number.isFinite(row.startMs) && Number.isFinite(row.endMs))
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  let widestPrevious = timedRows[0];

  // Same overlap sweep as saved rows, but using display IDs so the draft row can be highlighted too.
  for (let index = 1; index < timedRows.length; index += 1) {
    const current = timedRows[index];
    if (widestPrevious && current.startMs < widestPrevious.endMs) {
      overlaps.add(widestPrevious.displayId);
      overlaps.add(current.displayId);
    }
    if (!widestPrevious || current.endMs > widestPrevious.endMs) widestPrevious = current;
  }

  return overlaps;
}

function matchingRowIdForSelection() {
  const selection = normalizedSelection();
  if (!selection) return null;
  const match = state.rows.find((row) => (
    Math.abs(row.startMs - selection.start) <= 250 &&
    Math.abs(row.endMs - selection.end) <= 250
  ));
  return match?.id || null;
}

function scrollActiveRowIntoView() {
  const activeRow = els.rows.querySelector("tr.active[data-row-id]");
  if (!activeRow) return;
  const targetTop = activeRow.offsetTop - els.tableWrap.clientHeight + activeRow.offsetHeight;
  els.tableWrap.scrollTop = Math.max(0, targetTop);
}

function renderRows() {
  els.rows.innerHTML = "";
  const rows = displayRowsWithDraft();
  const overlaps = overlappingDisplayIds(rows);
  const matchingRowId = matchingRowIdForSelection();

  rows.forEach((row, index) => {
    const tr = document.createElement("tr");
    if (row.isDraft || row.isEditing || row.id === matchingRowId) tr.classList.add("active");
    if (row.isDraft) tr.classList.add("draft-row");
    if (overlaps.has(row.displayId)) tr.classList.add("overlap");
    if (!row.isDraft) tr.dataset.rowId = row.id;
    tr.innerHTML = `
      <td>${index + 1}</td>
      <td>${Number.isFinite(row.startMs) ? formatTableTime(row.startMs) : ""}</td>
      <td>${Number.isFinite(row.endMs) ? formatTableTime(row.endMs) : ""}</td>
      <td class="row-text"></td>
    `;
    tr.querySelector(".row-text").textContent = row.text;

    if (!row.isDraft) {
      tr.tabIndex = 0;
      tr.addEventListener("click", () => {
        loadRow(row.id, { focusText: true });
      });
    }

    els.rows.appendChild(tr);
  });

  updateRowToolState();
  scrollActiveRowIntoView();
}

// Event wiring: menus, file loading, waveform editing, playback shortcuts, and startup rendering.
els.input.addEventListener("change", async (event) => {
  await loadMedia(event.target.files[0]);
  els.input.value = "";
});
els.subtitleInput.addEventListener("change", (event) => {
  importSubtitles(event.target.files[0]).catch(() => {
    setStatus("Subtitle import failed. Try a standard .srt or .vtt file.");
    els.subtitleInput.value = "";
  });
});
els.exportButton.addEventListener("click", (event) => {
  event.stopPropagation();
  toggleExportMenu();
});
els.exportSrtOption.addEventListener("click", () => {
  closeExportMenu();
  exportSubtitles("srt");
});
els.exportVttOption.addEventListener("click", () => {
  closeExportMenu();
  exportSubtitles("vtt");
});
els.toolsButton.addEventListener("click", (event) => {
  event.stopPropagation();
  toggleToolsMenu();
});
els.mobileExportButton.addEventListener("click", (event) => {
  event.stopPropagation();
  toggleMobileExportMenu();
});
els.mobileExportSrtOption.addEventListener("click", () => {
  closeToolsMenu();
  exportSubtitles("srt");
});
els.mobileExportVttOption.addEventListener("click", () => {
  closeToolsMenu();
  exportSubtitles("vtt");
});
els.helpToggle.addEventListener("click", toggleHelpPanel);
els.mobileHelpToggle.addEventListener("click", () => {
  closeToolsMenu();
  toggleHelpPanel();
});
els.mobileMediaLabel.addEventListener("click", closeToolsMenu);
els.mobileSubtitleLabel.addEventListener("click", closeToolsMenu);
els.insertBeforeButton.addEventListener("click", insertRowBeforeCurrent);
els.insertAfterButton.addEventListener("click", insertRowAfterCurrent);
els.wrapTextToggle.addEventListener("change", toggleTableWrap);
els.videoResizer.addEventListener("pointerdown", (event) => {
  if (!els.editorGrid.classList.contains("video-layout")) return;
  state.resizingVideoLayout = true;
  els.videoResizer.classList.add("dragging");
  els.videoResizer.setPointerCapture(event.pointerId);
  setVideoColumnWidthFromPointer(event);
});
els.videoResizer.addEventListener("pointermove", (event) => {
  if (!state.resizingVideoLayout) return;
  setVideoColumnWidthFromPointer(event);
});
els.videoResizer.addEventListener("pointerup", (event) => {
  state.resizingVideoLayout = false;
  els.videoResizer.classList.remove("dragging");
  try {
    els.videoResizer.releasePointerCapture(event.pointerId);
  } catch (error) {
    // Pointer capture may already be released by the browser.
  }
});
els.videoResizer.addEventListener("pointercancel", () => {
  state.resizingVideoLayout = false;
  els.videoResizer.classList.remove("dragging");
});
document.addEventListener("click", (event) => {
  if (!els.exportMenu.hidden && !event.target.closest(".export-control")) closeExportMenu();
  if (!els.toolsMenu.hidden && !event.target.closest(".mobile-tools")) closeToolsMenu();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeExportMenu();
    closeToolsMenu();
  }
});

els.dropZone.addEventListener("dragover", (event) => {
  event.preventDefault();
  els.dropZone.classList.add("drag-over");
});

els.dropZone.addEventListener("dragleave", () => {
  els.dropZone.classList.remove("drag-over");
});

els.dropZone.addEventListener("drop", (event) => {
  event.preventDefault();
  els.dropZone.classList.remove("drag-over");
  loadMedia(event.dataTransfer.files[0]);
});

els.canvas.addEventListener("pointerdown", setSelectionFromPointer);
els.canvas.addEventListener("pointermove", dragMarker);
els.canvas.addEventListener("pointerup", stopDragging);
els.canvas.addEventListener("pointercancel", stopDragging);
els.canvas.addEventListener("contextmenu", (event) => event.preventDefault());
els.canvas.addEventListener("wheel", handleWaveformWheel, { passive: false });
els.overviewWindow.addEventListener("pointerdown", (event) => {
  if (!state.durationMs) return;
  const barRect = els.overviewBar.getBoundingClientRect();
  const x = Math.min(barRect.width, Math.max(0, event.clientX - barRect.left));
  const pointerMs = (x / Math.max(1, barRect.width)) * state.durationMs;
  state.overviewDragOffsetMs = pointerMs - state.viewStartMs;
  state.draggingOverview = true;
  els.overviewWindow.setPointerCapture(event.pointerId);
});
els.overviewWindow.addEventListener("pointermove", (event) => {
  if (state.draggingOverview) setOverviewFromPointer(event);
});
els.overviewWindow.addEventListener("pointerup", (event) => {
  state.draggingOverview = false;
  try {
    els.overviewWindow.releasePointerCapture(event.pointerId);
  } catch (error) {
    // Pointer capture may already be released by the browser.
  }
});
els.overviewWindow.addEventListener("pointercancel", () => {
  state.draggingOverview = false;
});
els.overviewBar.addEventListener("pointerdown", (event) => {
  if (event.target === els.overviewWindow) return;
  state.overviewDragOffsetMs = state.viewDurationMs / 2;
  setOverviewFromPointer(event);
});
els.prevWindowButton.addEventListener("click", () => moveWaveformWindow(-1));
els.nextWindowButton.addEventListener("click", () => moveWaveformWindow(1));
els.zoomInButton.addEventListener("click", () => {
  zoomWaveform("in");
});
els.zoomOutButton.addEventListener("click", () => {
  zoomWaveform("out");
});

for (const media of [els.audio, els.video]) {
  media.addEventListener("timeupdate", () => {
    if (media !== activeMedia()) return;
    state.playheadMs = Math.round(media.currentTime * 1000);
    if (state.stopAtMs !== null && state.playheadMs >= state.stopAtMs) stopPlayback();
    draw();
  });
  media.addEventListener("pause", () => {
    if (media !== activeMedia()) return;
    state.playheadMs = Math.round(media.currentTime * 1000);
    draw();
  });
  media.addEventListener("volumechange", () => {
    if (media !== activeMedia()) return;
    const otherMedia = media === els.video ? els.audio : els.video;
    if (otherMedia.src) {
      otherMedia.volume = media.volume;
      otherMedia.muted = media.muted;
    }
    draw();
  });
}

els.subtitleText.addEventListener("keydown", (event) => {
  const command = event.metaKey || event.ctrlKey;
  if (command && (event.key === "Delete" || event.key === "Backspace")) {
    event.preventDefault();
    deleteActiveRow();
    return;
  }

  if (command && event.key === "ArrowLeft") {
    event.preventDefault();
    els.subtitleText.setSelectionRange(0, 0);
    updateSteadyCaret();
    return;
  }

  if (command && event.key === "ArrowRight") {
    event.preventDefault();
    const end = els.subtitleText.value.length;
    els.subtitleText.setSelectionRange(end, end);
    updateSteadyCaret();
    return;
  }

  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    saveSubtitle();
  }
});

els.subtitleText.addEventListener("input", () => {
  updateSteadyCaret();
  commitActiveRowDraft();
  renderRows();
  scheduleAutosave();
});
els.subtitleText.addEventListener("click", updateSteadyCaret);
els.subtitleText.addEventListener("keyup", updateSteadyCaret);
els.subtitleText.addEventListener("select", updateSteadyCaret);
els.subtitleText.addEventListener("scroll", updateSteadyCaret);
els.subtitleText.addEventListener("focus", updateSteadyCaret);
els.subtitleText.addEventListener("blur", updateSteadyCaret);

document.addEventListener("keydown", (event) => {
  if (event.defaultPrevented) return;
  const key = event.key.toLowerCase();
  const isTyping = ["INPUT", "TEXTAREA"].includes(document.activeElement.tagName);
  const command = event.metaKey || event.ctrlKey;

  if (command && key === "s") {
    event.preventDefault();
    saveDraft({ manual: true });
    return;
  }

  if (command && key === "z" && event.shiftKey) {
    event.preventDefault();
    redo();
    return;
  }

  if (command && key === "z") {
    event.preventDefault();
    undo();
    return;
  }

  if (command && key === "p") {
    event.preventDefault();
    replaySelection();
    return;
  }

  if (command && (event.key === "Delete" || event.key === "Backspace") && state.activeRowId) {
    event.preventDefault();
    deleteActiveRow();
    return;
  }

  if (command && event.key === "ArrowLeft") {
    event.preventDefault();
    moveWaveformWindow(-1);
    return;
  }

  if (command && event.key === "ArrowRight") {
    event.preventDefault();
    moveWaveformWindow(1);
    return;
  }

  if (command && (key === "+" || key === "=")) {
    event.preventDefault();
    zoomWaveform("in");
    return;
  }

  if (command && key === "-") {
    event.preventDefault();
    zoomWaveform("out");
    return;
  }

  if (key === " " && !isTyping) {
    event.preventDefault();
    togglePlayback();
  }
});

window.addEventListener("resize", resizeCanvas);
window.addEventListener("beforeunload", warnBeforeRefresh);
window.addEventListener("pagehide", () => {
  if (state.draftDirty && hasActiveWork()) saveDraft();
});
resizeCanvas();
renderRows();
updateReadout();
restoreDraft();
