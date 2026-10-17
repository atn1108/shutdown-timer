"use strict";

/* ============ Elements ============ */
const ringSection = document.getElementById("ringSection");
const ringProgress = document.getElementById("ringProgress");
const timeDisplay = document.getElementById("timeDisplay");
const ringLabel = document.getElementById("ringLabel");
const statusLine = document.getElementById("statusLine");
const statusText = document.getElementById("statusText");
const presetsEl = document.getElementById("presets");
const inputHours = document.getElementById("inputHours");
const inputMinutes = document.getElementById("inputMinutes");
const inputSeconds = document.getElementById("inputSeconds");
const countdownPane = document.getElementById("countdownPane");
const clockPane = document.getElementById("clockPane");
const inputClockHours = document.getElementById("inputClockHours");
const inputClockMinutes = document.getElementById("inputClockMinutes");
const modeSeg = document.getElementById("modeSeg");
const actionSeg = document.getElementById("actionSeg");
const btnAction = document.getElementById("btnAction");
const actionLabel = document.getElementById("actionLabel");
const hintText = document.getElementById("hintText");
const toastEl = document.getElementById("toast");

document.getElementById("btnMinimize").addEventListener("click", () => window.timerAPI.minimize());
document.getElementById("btnClose").addEventListener("click", () => window.timerAPI.close());

/* ============ Constants ============ */
const CIRCUMFERENCE = 2 * Math.PI * 114; // khớp bán kính r=114 trong SVG
const MIN_SECONDS = 5;
const STORE_KEY = "shutdown-timer:endTime";
const ACTION_KEY = "shutdown-timer:action";
const MODE_KEY = "shutdown-timer:mode";
const URGENT_MS = 60 * 1000;

// Hành động khi hết giờ + tên tiếng Việt cho mọi label
const ACTIONS = {
  shutdown: { verb: "tắt", cap: "Tắt máy" },
  restart: { verb: "khởi động lại", cap: "Khởi động lại" },
  sleep: { verb: "ngủ", cap: "Ngủ" },
  logoff: { verb: "đăng xuất", cap: "Đăng xuất" },
};

// Các phiên AI/code cần đóng trước khi tắt máy — theo thứ tự ưu tiên
const INTERRUPT_PRIORITY = [
  "opencode",     // ưu tiên trước
  "antigravity",
  "cursor",
  "code",         // VS Code
  "windsurf",
  "trae",
  "claude",
  "zed",
];
const INTERRUPT_GRACE_MS = 60 * 1000; // còn 60s → đóng lịch sự (dialog lưu file được xử lý)
const INTERRUPT_FORCE_MS = 20 * 1000; // còn 20s → kill app còn sót

/* ============ State ============ */
let endTime = null; // timestamp (ms) máy sẽ thực hiện hành động
let action = "shutdown";
let mode = "countdown"; // countdown | clock
let tickHandle = null;
let graceInterrupted = false;
let forceInterrupted = false;
let lastTipSec = null; // throttle tooltip tray 1/s

ringProgress.style.strokeDasharray = String(CIRCUMFERENCE);
setIdle(true);

/* ============ Helpers ============ */
function pad(n) {
  return String(n).padStart(2, "0");
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.ceil(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

function formatClockTime(ts) {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/* Gán text đồng hồ + tự co font khi là HH:MM:SS (8 ký tự) để không chạm viền vòng */
function setTime(text) {
  timeDisplay.textContent = text;
  timeDisplay.classList.toggle("ring__time--wide", text.length > 5);
}

function setTrayTooltip(text) {
  window.timerAPI.setTrayTooltip(text);
}

let toastTimer = null;
function showToast(message, isError = false) {
  toastEl.textContent = message;
  toastEl.classList.toggle("toast--error", isError);
  toastEl.classList.add("toast--show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("toast--show"), 3200);
}

function readInputs() {
  const h = clamp(parseInt(inputHours.value, 10) || 0, 0, 99);
  const m = clamp(parseInt(inputMinutes.value, 10) || 0, 0, 59);
  const s = clamp(parseInt(inputSeconds.value, 10) || 0, 0, 59);
  return h * 3600 + m * 60 + s;
}

function clampInputs() {
  inputHours.value = clamp(parseInt(inputHours.value, 10) || 0, 0, 99);
  inputMinutes.value = clamp(parseInt(inputMinutes.value, 10) || 0, 0, 59);
  inputSeconds.value = clamp(parseInt(inputSeconds.value, 10) || 0, 0, 59);
}

function clampClockInputs() {
  inputClockHours.value = clamp(parseInt(inputClockHours.value, 10) || 0, 0, 23);
  inputClockMinutes.value = clamp(parseInt(inputClockMinutes.value, 10) || 0, 0, 59);
}

/* Số giây từ bây giờ tới giờ cố định đã nhập.
   Nếu giờ đó đã qua (hoặc sắp qua quá ít) → hiểu là vào giờ đó ngày mai. */
function clockDiffSeconds() {
  const now = new Date();
  const nowSec = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
  const targetSec = (clamp(parseInt(inputClockHours.value, 10) || 0, 0, 23)) * 3600 +
    (clamp(parseInt(inputClockMinutes.value, 10) || 0, 0, 59)) * 60;
  let diff = targetSec - nowSec;
  if (diff < MIN_SECONDS) diff += 86400;
  return diff;
}

function setClockDefault() {
  const d = new Date(Date.now() + 60 * 60 * 1000); // mặc định: 1 giờ nữa
  inputClockHours.value = d.getHours();
  inputClockMinutes.value = d.getMinutes();
}

/* ============ UI states ============ */
function idleHint() {
  if (action === "sleep") return "Máy sẽ tự ngủ — mọi app đang mở được giữ nguyên, thức dậy là còn nguyên.";
  if (action === "logoff") return "Đăng xuất sẽ đóng mọi app đang mở — nhớ lưu file trước.";
  return "Còn 60s: app tự đóng OpenCode → Cursor... trước khi tắt máy.";
}

/* Cập nhật mọi label theo action + mode khi đang ở trạng thái chờ */
function refreshIdleLabels() {
  if (mode === "clock") {
    updateClockPreview();
  } else {
    const total = readInputs();
    setTime(formatDuration(total));
    ringLabel.textContent = total >= MIN_SECONDS
      ? `${ACTIONS[action].cap} sau ${formatDuration(total)}`
      : "Chưa đặt lịch";
  }
  statusText.textContent = `Máy sẽ ${ACTIONS[action].verb} sau khi đếm ngược xong`;
  hintText.textContent = idleHint();
}

function setIdle(idle) {
  ringSection.classList.toggle("ring--idle", idle);
  const disabled = !idle;
  presetsEl.querySelectorAll(".chip").forEach((c) => (c.disabled = disabled));
  [inputHours, inputMinutes, inputSeconds, inputClockHours, inputClockMinutes].forEach(
    (el) => (el.disabled = disabled)
  );
  document.querySelectorAll(".seg__item").forEach((b) => (b.disabled = disabled));
}

function renderCountdown(totalSeconds, remainingSeconds) {
  const fraction = Math.max(0, Math.min(1, remainingSeconds / totalSeconds));
  ringProgress.style.strokeDashoffset = String(CIRCUMFERENCE * (1 - fraction));
  setTime(formatDuration(remainingSeconds));
  ringLabel.textContent = `${ACTIONS[action].cap} lúc ${formatClockTime(endTime)}`;

  // Tooltip tray + taskbar progress: cập nhật tối đa 1 lần/giây
  const secsLeft = Math.max(0, Math.ceil(remainingSeconds));
  if (secsLeft !== lastTipSec) {
    lastTipSec = secsLeft;
    setTrayTooltip(`Shutdown Timer — còn ${formatDuration(secsLeft)}`);
    window.timerAPI.setProgress(Math.max(0, Math.min(1, remainingSeconds / totalSeconds)));
  }

  const urgent = remainingSeconds * 1000 <= URGENT_MS;
  ringSection.classList.toggle("ring--urgent", urgent);
}

function enterRunningState(totalSeconds) {
  const remaining = (endTime - Date.now()) / 1000;
  renderCountdown(totalSeconds, remaining);

  statusLine.classList.add("status--active");
  statusLine.classList.remove("status--done");
  statusText.textContent = `Hẹn giờ đang chạy — sẽ ${ACTIONS[action].verb} đúng giờ`;

  btnAction.classList.add("action--cancel");
  actionLabel.textContent = "Hủy hẹn giờ";
  setIdle(false);

  if (tickHandle) clearInterval(tickHandle);
  tickHandle = setInterval(() => tick(totalSeconds), 250);
}

function finishCountdown() {
  clearInterval(tickHandle);
  tickHandle = null;
  ringProgress.style.strokeDashoffset = String(CIRCUMFERENCE);
  setTime("00:00");
  ringLabel.textContent = `Đang ${ACTIONS[action].verb}...`;
  ringSection.classList.remove("ring--urgent");
  ringSection.classList.add("ring--idle");
  setTrayTooltip(`Shutdown Timer — đang ${ACTIONS[action].verb}`);

  statusLine.classList.remove("status--active");
  statusLine.classList.add("status--done");
  statusText.textContent = `Hết giờ — đang ${ACTIONS[action].verb}...`;

  btnAction.disabled = true;
  actionLabel.textContent = `Đang ${ACTIONS[action].verb}...`;
  window.timerAPI.setRunning(false);
  window.timerAPI.setProgress(-1);
  localStorage.removeItem(STORE_KEY);
}

/* ============ Đóng các phiên AI trước khi tắt ============ */
async function interruptSessions(force) {
  const runningNote = force
    ? "Đang buộc đóng các phiên còn sót..."
    : "Đang đóng các phiên AI đang mở (OpenCode → Antigravity → Cursor...)...";
  statusText.textContent = runningNote;
  try {
    await window.timerAPI.interrupt(INTERRUPT_PRIORITY, force);
    if (!force) showToast("Đã đóng các phiên AI đang mở");
  } catch {
    /* app đã tự thoát giữa chừng là bình thường */
  }
  // status sẽ được renderCountdown tick sau cập nhật lại
}

function maybeInterrupt(remainingMs) {
  // Chế độ Ngủ: KHÔNG đóng gì — máy thức lại đúng trạng thái
  if (action === "sleep") return;
  if (!graceInterrupted && remainingMs <= INTERRUPT_GRACE_MS) {
    graceInterrupted = true;
    interruptSessions(false);
  }
  if (!forceInterrupted && remainingMs <= INTERRUPT_FORCE_MS) {
    forceInterrupted = true;
    interruptSessions(true);
  }
}

function tick(totalSeconds) {
  const remainingMs = endTime - Date.now();
  if (remainingMs <= 0) {
    finishCountdown();
    return;
  }
  renderCountdown(totalSeconds, remainingMs / 1000);
  maybeInterrupt(remainingMs);
}

function resetToIdle(message) {
  if (tickHandle) {
    clearInterval(tickHandle);
    tickHandle = null;
  }
  endTime = null;
  graceInterrupted = false;
  forceInterrupted = false;
  lastTipSec = null;
  window.timerAPI.setRunning(false);
  window.timerAPI.setProgress(-1);
  setTrayTooltip("");
  localStorage.removeItem(STORE_KEY);

  ringSection.classList.remove("ring--urgent");
  setIdle(true);
  ringProgress.style.strokeDashoffset = "0";
  refreshIdleLabels();

  btnAction.classList.remove("action--cancel");
  btnAction.disabled = false;
  actionLabel.textContent = "Bắt đầu hẹn giờ";

  if (message) showToast(message);
}

/* ============ Actions ============ */
async function start() {
  let totalSeconds;
  if (mode === "clock") {
    clampClockInputs();
    totalSeconds = clockDiffSeconds();
  } else {
    clampInputs();
    totalSeconds = readInputs();
    if (totalSeconds < MIN_SECONDS) {
      showToast(`Thời gian tối thiểu là ${MIN_SECONDS} giây`, true);
      return;
    }
  }

  btnAction.disabled = true;
  const result = await window.timerAPI.schedule(totalSeconds, action);
  btnAction.disabled = false;

  if (!result.ok) {
    showToast(`Không thể đặt lịch: ${result.message || "lỗi không xác định"}`, true);
    return;
  }

  endTime = Date.now() + result.seconds * 1000;
  localStorage.setItem(STORE_KEY, String(endTime));
  localStorage.setItem(ACTION_KEY, action);
  localStorage.setItem(MODE_KEY, mode);
  window.timerAPI.setRunning(true);
  enterRunningState(result.seconds);
  showToast(`Sẽ ${ACTIONS[action].verb} lúc ${formatClockTime(endTime)}`);

  // Hẹn giờ ngắn (≤60s / ≤20s) → đóng phiên ngay, không cần chờ tick
  graceInterrupted = false;
  forceInterrupted = false;
  maybeInterrupt(result.seconds * 1000);
}

async function cancel() {
  btnAction.disabled = true;
  await window.timerAPI.cancel();
  btnAction.disabled = false;
  resetToIdle("Đã hủy hẹn giờ");
}

btnAction.addEventListener("click", () => {
  if (endTime === null) start();
  else cancel();
});

window.timerAPI.onMenuCancel(() => {
  if (endTime !== null) cancel();
});

/* ============ Mode: đếm ngược / theo giờ ============ */
function setMode(next, resetClock = true) {
  if (endTime !== null || (next !== "countdown" && next !== "clock")) return;
  mode = next;
  countdownPane.hidden = next !== "countdown";
  clockPane.hidden = next !== "clock";
  modeSeg.querySelectorAll(".seg__item").forEach((b) => {
    const on = b.dataset.mode === next;
    b.classList.toggle("seg__item--active", on);
    b.setAttribute("aria-checked", String(on));
  });
  localStorage.setItem(MODE_KEY, next);
  presetsEl.querySelectorAll(".chip").forEach((c) => c.classList.remove("chip--selected"));
  if (next === "clock") {
    if (resetClock) setClockDefault();
    updateClockPreview();
  } else {
    refreshIdleLabels();
  }
}

modeSeg.addEventListener("click", (e) => {
  const item = e.target.closest(".seg__item");
  if (!item || item.disabled) return;
  setMode(item.dataset.mode);
});

/* ============ Hành động khi hết giờ ============ */
function updateClockPreview() {
  const diff = clockDiffSeconds();
  setTime(formatDuration(diff));
  const target = new Date(Date.now() + diff * 1000);
  ringLabel.textContent = `${ACTIONS[action].cap} lúc ${pad(target.getHours())}:${pad(target.getMinutes())}`;
}

function setAction(next) {
  if (endTime !== null || !ACTIONS[next]) return;
  action = next;
  actionSeg.querySelectorAll(".seg__item").forEach((b) => {
    const on = b.dataset.action === next;
    b.classList.toggle("seg__item--active", on);
    b.setAttribute("aria-checked", String(on));
  });
  localStorage.setItem(ACTION_KEY, next);
  refreshIdleLabels();
}

actionSeg.addEventListener("click", (e) => {
  const item = e.target.closest(".seg__item");
  if (!item || item.disabled) return;
  setAction(item.dataset.action);
});

/* ============ Presets & inputs ============ */
presetsEl.addEventListener("click", (e) => {
  const chip = e.target.closest(".chip");
  if (!chip || chip.disabled) return;

  presetsEl.querySelectorAll(".chip").forEach((c) => c.classList.remove("chip--selected"));
  chip.classList.add("chip--selected");

  const totalMinutes = Number(chip.dataset.minutes);
  inputHours.value = Math.floor(totalMinutes / 60);
  inputMinutes.value = totalMinutes % 60;
  inputSeconds.value = 0;
  setTime(formatDuration(totalMinutes * 60));
  ringLabel.textContent = `${ACTIONS[action].cap} sau ${totalMinutes >= 60 ? totalMinutes / 60 + " giờ" : totalMinutes + " phút"}`;
});

[inputHours, inputMinutes, inputSeconds].forEach((el) => {
  el.addEventListener("input", () => {
    presetsEl.querySelectorAll(".chip").forEach((c) => c.classList.remove("chip--selected"));
    const total = readInputs();
    setTime(formatDuration(total));
    ringLabel.textContent = total >= MIN_SECONDS
      ? `${ACTIONS[action].cap} sau ${formatDuration(total)}`
      : "Chưa đặt lịch";
  });
  el.addEventListener("blur", () => {
    clampInputs();
    setTime(formatDuration(readInputs()));
  });
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && endTime === null) start();
  });
});

[inputClockHours, inputClockMinutes].forEach((el) => {
  el.addEventListener("input", () => {
    if (mode === "clock") updateClockPreview();
  });
  el.addEventListener("blur", clampClockInputs);
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && endTime === null) start();
  });
});

/* ============ Resume từ phiên trước ============ */
(function resume() {
  const savedAction = localStorage.getItem(ACTION_KEY);
  if (savedAction && ACTIONS[savedAction]) setAction(savedAction);
  const savedMode = localStorage.getItem(MODE_KEY);
  if (savedMode === "clock") setMode("clock");

  const stored = Number(localStorage.getItem(STORE_KEY));
  if (stored && stored > Date.now()) {
    endTime = stored;
    window.timerAPI.setRunning(true);
    const totalSeconds = Math.round((endTime - Date.now()) / 1000) + 1;
    enterRunningState(totalSeconds);
    showToast("Đã tiếp tục hẹn giờ đang chạy");
  } else {
    localStorage.removeItem(STORE_KEY);
    if (mode !== "clock") setTime(formatDuration(readInputs()));
  }

  // Không hẹn giờ → dọn task rác của phiên trước; có hẹn giờ → giữ (Task Scheduler tự chạy)
  window.timerAPI.syncScheduledTasks(endTime !== null);
})();
