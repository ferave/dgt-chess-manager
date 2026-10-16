# DGT Chess Manager — interfaz de tablero

## Decisión tecnológica

Se prioriza **Chessground** (`@lichess-org/chessground` 10.2.0), la misma biblioteca reutilizada por el proyecto local `analizador-ajedrez`. Aporta representación SVG Cburnett, coordenadas, orientación, animación, resaltado de última jugada/jaque, flechas y marcadores, sin reconstruir un tablero desde cero. `src/components/ChessBoard.tsx` contiene únicamente el adaptador React; las reglas viven en `src/domain/game.ts`.

Evaluación realizada:

| Proyecto | Licencia | Estado/encaje | Decisión |
|---|---|---|---|
| Chessground | GPL-3.0-or-later | Maduro, mantenido por Lichess, API TypeScript; React requiere un wrapper | Adoptado |
| Chessboard.js | MIT | API sencilla, pero proyecto antiguo y dependiente de jQuery; requiere más trabajo para flechas/estado moderno | Alternativa |
| cm-chessboard | MIT | SVG modular y buena opción vanilla; integración React posible mediante wrapper | Alternativa si GPL no es compatible |

Chess.com no se usa como fuente de código ni de recursos: sus componentes internos no se consideran reutilizables.

Fuentes consultadas: [Chessground](https://github.com/lichess-org/chessground), [Chessboard.js](https://github.com/oakmac/chessboardjs) y [cm-chessboard](https://github.com/shaack/cm-chessboard). Las licencias deben volver a comprobarse al actualizar versiones.

## Obligaciones de Chessground

Chessground es GPL-3.0-or-later. Este frontend declara GPL-3.0-or-later para permitir la distribución del trabajo combinado. Una distribución binaria/web debe conservar los avisos de copyright y ofrecer el código fuente correspondiente y los términos de la GPL. Si DGT Chess Manager necesitara ser propietario o distribuirse bajo una licencia incompatible, no debe integrarse Chessground: habría que cambiar el adaptador por cm-chessboard o Chessboard.js y reevaluar sus avisos.

## Arquitectura

- `src/components/ChessBoard.tsx`: representación y eventos visuales.
- `src/domain/game.ts`: posición confirmada, reglas mediante `chess.js`, historial y PGN.
- `src/adapters/dgt.ts`: puerto para USB/serial DGT; el demo no altera el historial al recibir una posición física.
- `src/App.tsx`: composición, navegación histórica, preferencias y persistencia local.

La posición física tiene tres estados (`sincronizado`, `movimiento pendiente`, `desincronizado`). Una lectura DGT nunca añade por sí sola una jugada. El adaptador real debe emitir FEN y conexión desde el proceso de hardware, mientras el backend mantiene la fuente de verdad persistida.

## Desarrollo

```bash
npm install
npm run dev
```

El contrato `DgtAdapter` está preparado para sustituir `DemoDgtAdapter` por la comunicación real del Smart Board en Linux, Windows o macOS.

## Diagnóstico del DGT conectado

Con el tablero compartido en WSL como `/dev/ttyACM0`:

```bash
python3 -m pip install -r requirements-hardware.txt
python3 scripts/dgt_probe.py --port /dev/ttyACM0
```

El script usa el protocolo DGT a 9600 8N1, solicita `BOARD_DUMP` y muestra la FEN física. No escribe movimientos ni modifica la persistencia. Finaliza con `Ctrl+C`.

Para usar esa lectura en la interfaz, el modo recomendado multiplataforma autodetecta el DGT por VID/PID (`045b:8111`):

```bash
# Terminal 1: puente físico
python3 scripts/dgt_server.py --port auto

# Terminal 2: interfaz
npm run dev -- --host 0.0.0.0
```

También puedes iniciar ambos procesos con un solo comando:

```bash
npm start
```

En Windows usa `py scripts\dgt_server.py --port auto` si ejecutas el puente manualmente; en macOS usa `python3 scripts/dgt_server.py --port auto`. Si hay más de un DGT, el servicio evita elegir silenciosamente el tablero equivocado y muestra los puertos detectados para asignarlos explícitamente.

La interfaz consulta `http://127.0.0.1:8787/api/dgt/state` mediante el proxy de Vite. La posición inicial identifica una nueva partida y una posición física estable que coincide con una única jugada legal se confirma automáticamente tras una breve estabilización. Las lecturas intermedias (por ejemplo, una pieza levantada) permanecen como movimiento pendiente y no alteran el historial. El tablero es la fuente de verdad: el reloj es opcional, se registra como dato adicional y nunca bloquea, cambia o elimina la partida.

## Aplicación Windows

El instalador debe compilarse en Windows o mediante el workflow `.github/workflows/windows.yml`. La versión generada desde WSL no debe usarse como instalador final: puede crear un ejecutable incompleto y no incluye correctamente el puente DGT.

## Aplicación Android con USB-OTG

La APK Android reutiliza esta misma interfaz y lógica de partida mediante Capacitor. Al abrirla, detecta directamente un DGT e-Board conectado por USB-OTG (VID/PID `045b:8111`), solicita permiso de Android y lee las posiciones sin PC, red ni puente Python.

```bash
npm install
npm run android:sync
cd android
./gradlew :app:assembleDebug
```

El APK resultante queda en `android/app/build/outputs/apk/debug/`. Para compilar se requiere JDK 17 o posterior y Android SDK. Conecta el DGT antes de abrir la aplicación y acepta el permiso USB cuando Android lo solicite.

También puede generarse sin instalar Android Studio: sube estos cambios a GitHub, abre **Actions → Android APK → Run workflow** y descarga el artefacto `DGT-Chess-Manager-Android-debug` al terminar.

## Autor

**Ronald Fernando Avellaneda Arévalo**  
Ingeniero Electrónico · Magíster en Transformación Digital  
Actualmente en Red Hat · Maestro Nacional de Ajedrez

Este proyecto combina ingeniería electrónica, software y ajedrez para conectar tableros DGT con herramientas digitales de gestión y análisis.

[Perfil de LinkedIn](https://www.linkedin.com/in/ronald-fernando-avellaneda-arevalo-79b17464/)
