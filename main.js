const { app, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage, screen } = require('electron');
const { exec } = require('child_process');
const path = require('path');

const MIN_SECONDS = 5;
const MAX_SECONDS = 315360000; // giới hạn của lệnh shutdown /t

let mainWindow = null;
let tray = null;
let timerRunning = false;
let forceClose = false;

// Hành động đang chạy (shutdown | restart | sleep | logoff)
let currentAction = 'shutdown';
// Timer app-level cho sleep/logoff (2 hành động này không có lệnh trì hoãn của Windows)
let pendingLocalTimer = null;

// --- Lệnh OS ------------------------------------------------------------
function runCommand(cmd) {
  return new Promise((resolve) => {
    exec(cmd, { windowsHide: true }, (err, _stdout, stderr) => {
      if (err) resolve({ ok: false, message: (stderr || err.message || '').trim() });
      else resolve({ ok: true });
    });
  });
}

function scheduleOS(seconds, action) {
  const flag = action === 'restart' ? '/r' : '/s';
  return runCommand(`shutdown ${flag} /t ${seconds}`);
}

function cancelShutdown() {
  // shutdown /a hủy cả lịch /s lẫn /r
  return runCommand('shutdown /a').then((r) => ({ ...r, ok: true }));
}

function execSleep() {
  // SetSuspendState(PowerState.Suspend, force=false, disableWake=false)
  runCommand(
    `powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; ` +
      `[System.Windows.Forms.Application]::SetSuspendState('Suspend', $false, $false); exit 0"`
  );
}

function execLogoff() {
  runCommand('logoff');
}

function clearLocalTimer() {
  if (pendingLocalTimer) {
    clearTimeout(pendingLocalTimer.timer);
    pendingLocalTimer = null;
  }
}

// Đặt lịch hành động — shutdown/restart giao thẳng cho Windows (sống lâu hơn app),
// sleep/logoff chạy app-level (cần app sống — tray giữ app sống khi đóng cửa sổ)
async function scheduleAction(seconds, action) {
  const s = Math.min(MAX_SECONDS, Math.max(MIN_SECONDS, Math.round(seconds)));
  clearLocalTimer();

  if (action === 'shutdown' || action === 'restart') {
    const r = await scheduleOS(s, action);
    if (r.ok) currentAction = action;
    return r.ok ? { ok: true, seconds: s, action } : r;
  }

  // sleep / logoff: lên lịch trong main process
  currentAction = action;
  const timer = setTimeout(() => {
    pendingLocalTimer = null;
    if (action === 'sleep') execSleep();
    else execLogoff();
  }, s * 1000);
  pendingLocalTimer = { timer, action };
  return { ok: true, seconds: s, action };
}

async function cancelScheduled() {
  clearLocalTimer();
  const r = await cancelShutdown(); // best-effort cho cả khi không có lịch OS
  return { ...r, ok: true };
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
  // Chiều cao theo màn hình thật (display scaling 125%+ dễ vượt đáy)
  const workArea = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workAreaSize;
  const winW = 460;
  const winH = Math.min(720, workArea.height);

  mainWindow = new BrowserWindow({
    width: winW,
    height: winH,
    minWidth: winW,
    minHeight: winH,
    maxWidth: winW,
    maxHeight: winH,
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
      // Đồng hồ đếm ngược phải chính xác ngay cả khi cửa sổ đang ẩn trong tray
      backgroundThrottling: false,
    },
  });

  mainWindow.loadFile('index.html');
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.center();
  });

  mainWindow.on('close', (e) => {
    if (forceClose) return;
    if (!timerRunning) return; // không hẹn giờ → đóng là thoát hẳn
    // Đang hẹn giờ → đóng cửa sổ nghĩa là ẩn vào tray, app vẫn đếm
    e.preventDefault();
    mainWindow.hide();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// --- Tray --------------------------------------------------------------
function showWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function quitApp() {
  if (timerRunning) {
    const isLocal = currentAction === 'sleep' || currentAction === 'logoff';
    const choice = dialog.showMessageBoxSync(mainWindow || undefined, {
      type: 'warning',
      buttons: ['Ở lại', 'Vẫn thoát'],
      defaultId: 0,
      cancelId: 0,
      title: 'Hẹn giờ đang chạy',
      message: 'Hẹn giờ vẫn đang diễn ra.',
      detail: isLocal
        ? 'Hành động "Ngủ/Đăng xuất" sẽ bị HỦY nếu bạn thoát app hoàn toàn.\n' +
          'Nếu chỉ đóng cửa sổ (✕) thì app chạy nền trong khay và vẫn đúng giờ.'
        : 'Windows vẫn sẽ thực hiện đúng giờ kể cả khi bạn thoát ứng dụng.',
    });
    if (choice !== 1) return;
  }
  forceClose = true;
  app.quit();
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon.png'));
  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  tray.setToolTip('Shutdown Timer');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Mở Shutdown Timer', click: showWindow },
      {
        label: 'Hủy hẹn giờ',
        click: () => {
          if (mainWindow) {
            showWindow();
            mainWindow.webContents.send('menu-cancel');
          }
        },
      },
      { type: 'separator' },
      { label: 'Thoát', click: quitApp },
    ])
  );
  tray.on('double-click', showWindow);
  tray.on('click', showWindow);
}

// --- IPC ---------------------------------------------------------------
ipcMain.handle('schedule', (_e, seconds, action) =>
  scheduleAction(seconds, typeof action === 'string' ? action : 'shutdown')
);
ipcMain.handle('cancel', () => cancelScheduled());
ipcMain.handle('interrupt', (_e, payload) => interruptSessions(payload && payload.names, payload && payload.force));
ipcMain.on('set-running', (_e, value) => {
  timerRunning = !!value;
});
ipcMain.on('tray-tooltip', (_e, text) => {
  if (tray) tray.setToolTip(typeof text === 'string' && text ? text.slice(0, 120) : 'Shutdown Timer');
});
ipcMain.on('win-minimize', () => mainWindow && mainWindow.minimize());
ipcMain.on('win-close', () => mainWindow && mainWindow.close());

// Smoke test tự chạy khi bật env ST_SMOKE — kiểm chứng e2e UI → IPC → lệnh OS
// (dùng shutdown /s /t 30 rồi hủy ngay; KHÔNG dùng cho restart/sleep/logoff)
async function smokeTest() {
  const js = (code) => mainWindow.webContents.executeJavaScript(code, true);
  const log = (...a) => console.log('[SMOKE]', ...a);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    await sleep(1200); // chờ app render xong
    // 1. preset → label
    let r = await js(`document.querySelector('.chip[data-minutes="15"]').click(); document.getElementById('ringLabel').textContent`);
    log('preset15:', r);
    // 2. mode clock → pane hiện + label theo action
    r = await js(`document.querySelector('.seg__item[data-mode="clock"]').click(); [!document.getElementById('clockPane').hidden, document.getElementById('ringLabel').textContent].join(' | ')`);
    log('clock-mode:', r);
    // 3. action restart → label đổi verb
    r = await js(`document.querySelector('.seg__item[data-action="restart"]').click(); document.getElementById('ringLabel').textContent`);
    log('action-restart:', r);
    // 4. schedule thật shutdown 30s
    r = await js(`document.querySelector('.seg__item[data-action="shutdown"]').click();
      document.querySelector('.seg__item[data-mode="countdown"]').click();
      const set=(id,v)=>document.getElementById(id).value=v; set('inputHours',0); set('inputMinutes',0); set('inputSeconds',30);
      document.getElementById('btnAction').click(); 'clicked'`);
    log('start:', r);
    await sleep(1500);
    r = await js(`document.getElementById('statusText').textContent + ' | ' + document.getElementById('timeDisplay').textContent`);
    log('running:', r);
    // 5. hủy qua kênh menu tray
    mainWindow.webContents.send('menu-cancel');
    await sleep(1500);
    r = await js(`document.getElementById('statusText').textContent + ' | ' + document.getElementById('actionLabel').textContent`);
    log('after-cancel:', r);
    log('SMOKE DONE');
  } catch (e) {
    log('SMOKE ERROR', e && e.message);
  } finally {
    await cancelScheduled().catch(() => {}); // chốt chặn: không bao giờ bỏ sót lịch shutdown
    app.exit(0);
  }
}

// --- App ---------------------------------------------------------------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.setAppUserModelId('com.atn1108.shutdowntimer');

  app.on('second-instance', () => showWindow());

  app.whenReady().then(() => {
    createWindow();
    createTray();
    if (process.env.ST_SMOKE) setTimeout(smokeTest, 1200);
  });

  app.on('window-all-closed', () => {
    app.quit();
  });

  app.on('will-quit', () => {
    clearLocalTimer();
    if (tray) {
      tray.destroy();
      tray = null;
    }
  });
}
