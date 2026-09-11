# NCH1 · Cadlan — seguimiento de pendientes BMS

App de seguimiento de pendientes del proyecto NCH1 (BMS y controles) con base
compartida y un bot de Telegram que carga y cierra pendientes desde la obra.

## Qué hay

- **Listas internos / externos.** El orden de las filas lo fijan las flechas de
  cada fila; cambiar estado, urgencia o responsable no mueve nada de lugar.
- **Responsables múltiples**, fecha límite de entrega, áreas y sub-áreas editables.
- **Dependencias entre pendientes** ("A bloquea a D"), con distinción entre
  bloqueo interno (lo resuelve el equipo) y externo (depende de un tercero).
- **Gantt** y **malla de dependencias** como vistas de la misma base.
- **Informe semanal en PDF** (`/api/reporte/pdf`), con el logo de CadLan.

## Estructura

| Ruta | Qué hace |
|---|---|
| `app/api/state` | Estado completo para la app (tareas, catálogo, bloqueos) |
| `app/api/ops` | Altas, cambios y vínculos que manda la app |
| `app/api/reporte/pdf` | Informe semanal en PDF |
| `app/api/bot/*` | API del bot de Telegram (buscar, crear, actualizar, catálogo, reporte) |
| `lib/db.js` | Acceso a Postgres (Neon) y migraciones |
| `lib/comun.js` | Responsables múltiples y grafo de dependencias |
| `lib/informe.js` | Cálculo del informe del período |
| `lib/pdf.js` | Armado del PDF |

## Variables de entorno

| Variable | Para qué |
|---|---|
| `DATABASE_URL` | Postgres (Neon). Sin esto la app queda en modo local por navegador. |
| `BOT_API_TOKEN` | Bearer que exige `/api/bot/*`. |

## Notas

- Las consultas salen con `cache: no-store` y un comentario único. Sin eso, la
  caché de fetch de Next devuelve resultados viejos de forma indefinida.
- `SEED_TAREAS` está vacío a propósito: los pendientes viven en la base desde el
  7/9/2026 y reponer una copia congelada borraría el trabajo del equipo.
