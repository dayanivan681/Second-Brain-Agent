# Briefing diario de Today

`src/briefing/` + `scripts/daily-briefing.ts` + `.github/workflows/daily-briefing.yml`.

## Qué contiene

| Sección | Origen | Siempre |
|---|---|---|
| Agenda del día | `CalendarSource` (Google Calendar, solo lectura) | Si hay calendario |
| Objetivos activos | Memoria | Sí |
| Cambios desde el briefing anterior | Revisiones (altas, correcciones, retracciones, eliminaciones sin texto) | Sí |
| Fuentes antiguas | Frescura de las memorias activas | Sí |
| Hasta 3 prioridades con citas | Agente en modo **solo lectura** | Si hay modelo |
| Salud (`calendar`, `model`) y avisos | Rutina | Sí |

Un fallo del calendario o del modelo se muestra como aviso y salud `error`; el
resto del briefing se entrega igual.

## Rutina

- `runDailyBriefing`: uno por fecha local (`BRIEFING_TZ`), idempotente; `--force` lo
  regenera conservando la valoración.
- Programación: GitHub Actions, lunes a viernes 11:00 UTC (ajustar), o a mano con
  *Run workflow*. Sin `DATABASE_URL` termina sin hacer nada.
- Secretos del repositorio: `DATABASE_URL`, `OPENAI_API_KEY`. Variables:
  `OPENAI_CHAT_MODEL`, `BRIEFING_TZ`.

## Valoración y criterio de aceptación

`recordFeedback(fecha, útil, nota)` y `usefulness()`: el piloto se aprueba con al
menos 8 de los últimos 10 días laborables valorados como útiles.

## Eliminación

Los briefings guardan texto de memorias. `forgetMemory` elimina la memoria y la
redacta en todos los briefings que la mencionan (quita objetivos, texto de
cambios, prioridades que la citaban y el resumen). Toda eliminación pedida por el
usuario debe usar `forgetMemory`.

## Pendiente

- Adaptador de Google Calendar (requiere autorización OAuth propia de la app).
- Mostrar el briefing en la app (Today) y los botones de valoración.
