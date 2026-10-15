import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const python = process.platform === 'win32' ? 'python' : 'python3';
const bridge = spawn(python, ['scripts/dgt_server.py', '--port', 'auto'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
const web = spawn('npm', ['run', 'dev', '--', '--host', '0.0.0.0'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
const stop = () => { bridge.kill(); web.kill(); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
