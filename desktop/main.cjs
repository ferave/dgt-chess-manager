const { app, BrowserWindow } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

let bridge;

function startBridge() {
  const base = app.isPackaged ? process.resourcesPath : path.join(__dirname, '..');
  const bundled = process.platform === 'win32' ? path.join(base, 'dgt_server.exe') : path.join(base, 'dgt_server');
  const script = app.isPackaged ? path.join(process.resourcesPath, 'scripts', 'dgt_server.py') : path.join(base, 'scripts', 'dgt_server.py');
  const embeddedPython = process.platform === 'win32' ? path.join(base, 'python', 'python.exe') : '';
  const logPath = path.join(app.getPath('userData'), 'dgt-bridge.log');
  const log = line => { try { fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${line}\n`); } catch { /* no bloquear la app */ } };
  log(`Iniciando puente. base=${base} script=${script}`);
  if (fs.existsSync(bundled)) bridge = spawn(bundled, ['--port', 'auto'], { cwd: base, windowsHide: true });
  else if (embeddedPython && fs.existsSync(embeddedPython)) bridge = spawn(embeddedPython, [script, '--port', 'auto'], { cwd: base, windowsHide: true });
  else bridge = spawn(process.platform === 'win32' ? 'python' : 'python3', [script, '--port', 'auto'], { cwd: base, windowsHide: true });
  bridge.stdout?.on('data', data => log(`stdout: ${data.toString().trim()}`));
  bridge.stderr?.on('data', data => log(`stderr: ${data.toString().trim()}`));
  bridge.on('error', error => { log(`error: ${error.stack || error.message}`); console.error('No se pudo iniciar el puente DGT:', error.message); });
  bridge.on('exit', (code, signal) => log(`puente finalizado code=${code} signal=${signal}`));
}

function createWindow() {
  const window = new BrowserWindow({ width: 1440, height: 1000, minWidth: 960, minHeight: 720, autoHideMenuBar: true, webPreferences: { contextIsolation: true, nodeIntegration: false } });
  // desktop:dev compila primero y no inicia Vite; cargar el build evita
  // ERR_CONNECTION_REFUSED cuando no hay un servidor de desarrollo activo.
  window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

app.whenReady().then(() => { startBridge(); createWindow(); });
app.on('window-all-closed', () => { bridge?.kill(); if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => bridge?.kill());
