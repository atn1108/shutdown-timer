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
const URGENT_MS = 60 * 1000;

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
let endTime = null; // timestamp (ms) máy sẽ tắt
let tickHandle = null;
let graceInterrupted = false;
let forceInterrupted = false;

ringProgress.style.strokeDasharray = String(CIRCUMFERENCE);
setIdle(true);

/* ============ Helpers ============ */
function pad(n) {
  return String(n).padStart(2, "0");
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

let toastTimer = null;
function showToast(message, isError = false) {
  toastEl.textContent = message;
  toastEl.classList.toggle("toast--error", isError);
  toastEl.classList.add("toast--show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("toast--show"), 3200);
}

function readInputs() {
  const h = Math.min(99, Math.max(0, parseInt(inputHours.value, 10) || 0));
  const m = Math.min(59, Math.max(0, parseInt(inputMinutes.value, 10) || 0));
  const s = Math.min(59, Math.max(0, parseInt(inputSeconds.value, 10) || 0));
  return h * 3600 + m * 60 + s;
}

function clampInputs() {
  inputHours.value = Math.min(99, Math.max(0, parseInt(inputHours.value, 10) || 0));
  inputMinutes.value = Math.min(59, Math.max(0, parseInt(inputMinutes.value, 10) || 0));
  inputSeconds.value = Math.min(59, Math.max(0, parseInt(inputSeconds.value, 10) || 0));
}

/* ============ UI states ============ */
function setIdle(idle) {
  ringSection.classList.toggle("ring--idle", idle);
  presetsEl.querySelectorAll(".chip").forEach((c) => (c.disabled = idle === false));
  [inputHours, inputMinutes, inputSeconds].forEach((el) => (el.disabled = idle === false));
}

function renderCountdown(totalSeconds, remainingSeconds) {
  const fraction = Math.max(0, Math.min(1, remainingSeconds / totalSeconds));
  ringProgress.style.strokeDashoffset = String(CIRCUMFERENCE * (1 - fraction));
  setTime(formatDuration(remainingSeconds));
  ringLabel.textContent = `Tắt máy lúc ${formatClockTime(endTime)}`;

  const urgent = remainingSeconds * 1000 <= URGENT_MS;
  ringSection.classList.toggle("ring--urgent", urgent);
}

function enterRunningState(totalSeconds) {
  const remaining = (endTime - Date.now()) / 1000;
  renderCountdown(totalSeconds, remaining);

  statusLine.classList.add("status--active");
  statusLine.classList.remove("status--done");
  statusText.textContent = "Hẹn giờ đang chạy — máy sẽ tự tắt đúng giờ";

  btnAction.classList.add("action--cancel");
  actionLabel.textContent = "Hủy hẹn giờ";
  hintText.textContent = "Hủy trước khi hết giờ để giữ máy đang chạy.";
  setIdle(false);

  if (tickHandle) clearInterval(tickHandle);
  tickHandle = setInterval(() => tick(totalSeconds), 250);
}

function finishCountdown() {
  clearInterval(tickHandle);
  tickHandle = null;
  ringProgress.style.strokeDashoffset = String(CIRCUMFERENCE);
  setTime("00:00");
  ringLabel.textContent = "Đang tắt máy";
  ringSection.classList.remove("ring--urgent");
  ringSection.classList.add("ring--idle");

  statusLine.classList.remove("status--active");
  statusLine.classList.add("status--done");
  statusText.textContent = "Hết giờ — Windows đang tắt máy...";

  btnAction.disabled = true;
  actionLabel.textContent = "Đang tắt máy...";
  window.timerAPI.setRunning(false);
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
  window.timerAPI.setRunning(false);
  localStorage.removeItem(STORE_KEY);

  ringSection.classList.remove("ring--urgent");
  setIdle(true);
  ringProgress.style.strokeDashoffset = "0";
  setTime(formatDuration(readInputs()));
  ringLabel.textContent = "Chưa đặt lịch";

  statusLine.classList.remove("status--active", "status--done");
  statusText.textContent = "Máy sẽ tự tắt sau khi đếm ngược xong";

  btnAction.classList.remove("action--cancel");
  btnAction.disabled = false;
  actionLabel.textContent = "Bắt đầu hẹn giờ";
  hintText.textContent =
    "Còn 60s: app tự đóng OpenCode → Cursor... trước khi tắt máy.";

  if (message) showToast(message);
}

/* ============ Actions ============ */
async function start() {
  clampInputs();
  const totalSeconds = readInputs();
  if (totalSeconds < MIN_SECONDS) {
    showToast(`Thời gian tối thiểu là ${MIN_SECONDS} giây`, true);
    return;
  }

  btnAction.disabled = true;
  const result = await window.timerAPI.schedule(totalSeconds);
  btnAction.disabled = false;

  if (!result.ok) {
    showToast(`Không thể đặt lịch tắt máy: ${result.message || "lỗi không xác định"}`, true);
    return;
  }

  endTime = Date.now() + result.seconds * 1000;
  localStorage.setItem(STORE_KEY, String(endTime));
  window.timerAPI.setRunning(true);
  enterRunningState(result.seconds);
  showToast(`Máy sẽ tắt lúc ${formatClockTime(endTime)}`);

  // Hẹn giờ ngắn (≤60s / ≤20s) → đóng phiên ngay, không cần chờ tick
  graceInterrupted = false;
  forceInterrupted = false;
  maybeInterrupt(result.seconds * 1000);
}

async function cancel() {
  btnAction.disabled = true;
  await window.timerAPI.cancel();
  btnAction.disabled = false;
  resetToIdle("Đã hủy hẹn giờ tắt máy");
}

btnAction.addEventListener("click", () => {
  if (endTime === null) start();
  else cancel();
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
  ringLabel.textContent = `Tắt máy sau ${totalMinutes >= 60 ? totalMinutes / 60 + " giờ" : totalMinutes + " phút"}`;
});

[inputHours, inputMinutes, inputSeconds].forEach((el) => {
  el.addEventListener("input", () => {
    presetsEl.querySelectorAll(".chip").forEach((c) => c.classList.remove("chip--selected"));
    const total = readInputs();
    setTime(formatDuration(total));
    ringLabel.textContent = total >= MIN_SECONDS ? `Tắt máy sau ${formatDuration(total)}` : "Chưa đặt lịch";
  });
  el.addEventListener("blur", () => {
    clampInputs();
    const total = readInputs();
    setTime(formatDuration(total));
  });
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && endTime === null) start();
  });
});

/* ============ Resume từ phiên trước ============ */
(function resume() {
  const stored = Number(localStorage.getItem(STORE_KEY));
  if (stored && stored > Date.now()) {
    endTime = stored;
    window.timerAPI.setRunning(true);
    const totalSeconds = Math.round((endTime - Date.now()) / 1000) + 1;
    enterRunningState(totalSeconds);
    showToast("Đã tiếp tục hẹn giờ đang chạy");
  } else {
    localStorage.removeItem(STORE_KEY);
    setTime(formatDuration(readInputs()));
  }
})();
