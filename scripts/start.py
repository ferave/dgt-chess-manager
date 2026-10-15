#!/usr/bin/env python3
"""Inicio común para Linux, Windows y macOS.

El puente detecta automáticamente el DGT. Vite se inicia como proceso aparte
para que la interfaz pueda utilizar el mismo flujo en los tres sistemas.
"""
from __future__ import annotations

import os
import signal
import subprocess
import sys


root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
python = sys.executable
bridge = subprocess.Popen([python, os.path.join(root, "scripts", "dgt_server.py"), "--port", "auto"], cwd=root)
web = subprocess.Popen(["npm", "run", "dev", "--", "--host", "0.0.0.0"], cwd=root)

try:
    bridge.wait()
finally:
    if web.poll() is None:
        web.send_signal(signal.SIGTERM)
