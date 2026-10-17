const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { exec } = require('child_process');
const path = require('path');

const MIN_SECONDS = 5;
const MAX_SECONDS = 315360000; // giới hạn của lệnh shutdown /t

let mainWindow = null;
let timerRunning = false;
let forceClose = false;

// --- Shutdown / cancel -------------------------------------------------
function scheduleShutdown(seconds) {
  return new Promise((resolve) => {
    const s = Math.min(MAX_SECONDS, Math.max(MIN_SECONDS, Math.round(seconds)));
    exec(`shutdown /s /t ${s}`, { windowsHide: true }, (err, _stdout, stderr) => {
      if (err) resolve({ ok: false, message: (stderr || err.message || '').trim() });
      else resolve({ ok: true, seconds: s });
    });
  });
}

function cancelShutdown() {
  return new Promise((resolve) => {
    exec('shutdown /a', { windowsHide: true }, (err, _stdout, stderr) => {
      // "không có lịch tắt máy đang chờ" cũng coi như đã hủy -> ok
      resolve({ ok: true, note: (stderr || '').trim(), hadError: !!err });
    });
  });
}

// --- Đóng các phiên AI trước khi tắt máy -------------------------------
// Whitelist tên process hợp lệ (chống injection qua IPC)
const NAME_RE = /^[a-z0-9_.-]+$/i;

function psCommand(names, force) {
  const list = names.map((n) => `'${n}'`).join(',');
  // Luôn exit 0: interrupt là best-effort, mọi error đã được SilentlyContinue
  if (force) {
    // Giai đoạn 2: kill những app còn sót
    return `Get-Process -Name ${list} -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue; exit 0`;
  }
  // Giai đoạn 1: đóng cửa sổ một cách lịch sự (app có thể hiện dialog lưu)
  // Đóng theo thứ tự ưu tiên, nhường 250ms cho app trước kịp dọn dẹp
  return `'${names.join("','")}' | ForEach-Object { ` +
    `Get-Process -Name $_ -ErrorAction SilentlyContinue | ` +
    `Where-Object { $_.MainWindowHandle -ne 0 } | ` +
    `ForEach-Object { $_.CloseMainWindow() | Out-Null }; Start-Sleep -Milliseconds 250 }; exit 0`;
}

function interruptSessions(names, force) {
  return new Promise((resolve) => {
    const safe = (Array.isArray(names) ? names : []).filter((n) => NAME_RE.test(n));
    if (!safe.length) return resolve({ ok: true, closed: [] });
    const script = psCommand(safe, force);
    exec(`powershell -NoProfile -Command "${script}"`, { windowsHide: true }, (err, stdout) => {
      resolve({ ok: !err, force: !!force, closed: safe, output: (stdout || '').trim() });
    });
  });
}

// --- Window ------------------------------------------------------------
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 460,
    height: 720,
    minWidth: 460,
    minHeight: 720,
    maxWidth: 460,
    maxHeight: 720,
    frame: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    backgroundColor: '#0B0F17',
    show: false,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile('index.html');
  mainWindow.once('ready-to-show', () => mainWindow.show());

  mainWindow.on('close', (e) => {
    if (forceClose) return;
    if (!timerRunning) return;
    e.preventDefault();
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: 'warning',
      buttons: ['Ở lại', 'Vẫn đóng'],
      defaultId: 0,
      cancelId: 0,
      title: 'Hẹn giờ đang chạy',
      message: 'Hẹn giờ tắt máy vẫn đang diễn ra.',
      detail:
        'Windows vẫn sẽ tắt máy đúng giờ kể cả khi bạn đóng ứng dụng. ' +
        'Chọn "Vẫn đóng" để thoát, chọn "Ở lại" để tiếp tục đếm ngược.',
    });
    if (choice === 1) {
      forceClose = true;
      mainWindow.close();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// --- IPC ---------------------------------------------------------------
ipcMain.handle('schedule', (_e, seconds) => scheduleShutdown(seconds));
ipcMain.handle('cancel', () => cancelShutdown());
ipcMain.handle('interrupt', (_e, payload) => interruptSessions(payload && payload.names, payload && payload.force));
ipcMain.on('set-running', (_e, value) => {
  timerRunning = !!value;
});
ipcMain.on('win-minimize', () => mainWindow && mainWindow.minimize());
ipcMain.on('win-close', () => mainWindow && mainWindow.close());

// --- App ---------------------------------------------------------------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(createWindow);

  app.on('window-all-closed', () => {
    app.quit();
  });
}
