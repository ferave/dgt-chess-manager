# Modo torneo

El torneo usa un modelo normalizado en `src/domain/tournament.ts`. Los datos procedentes de Chess-Results, CSV, JSON, una API o edición manual terminan como `TournamentRound` y `Pairing`; el tablero no depende del origen del pareo.

## Flujo previsto

1. Crear torneo y elegir formato: suizo, todos contra todos, eliminación, equipos o personalizado.
2. Importar jugadores y pareos desde Chess-Results, CSV, JSON o API, o editarlos manualmente.
3. Asignar `boardId` a cada `Pairing` y asociarlo a una mesa.
4. El backend espera la posición inicial del DGT asignado.
5. Al detectar la posición inicial, crea el `gameId` vinculado a torneo, ronda y mesa.
6. Las jugadas estables se confirman y guardan en esa partida.
7. La transmisión publica solo movimientos confirmados.

## CSV mínimo

```csv
round,table,whiteId,blackId
1,1,p1,p2
1,2,p3,p4
```

## Salidas de transmisión

- Vista local de todas las mesas.
- Página individual por partida.
- Exportación PGN y JSON completo.
- Canal SSE/WebSocket para espectadores remotos.

La asignación debe vivir en el backend, no en el tablero gráfico: si se desconecta un DGT, la mesa conserva su partida, historial y pareo.
