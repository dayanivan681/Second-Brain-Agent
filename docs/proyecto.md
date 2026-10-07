# Proyecto

## Objetivo

Recordar información importante, explicar cambios y recomendar próximos pasos con
evidencia, distinguiendo siempre **hechos**, **inferencias** y **recomendaciones**.

## Autoridad de los datos

| Dato | Autoridad | Papel de la aplicación |
|---|---|---|
| Objetivos, reglas, decisiones | Obsidian | Copia derivada; los cambios se consolidan primero en Obsidian |
| Eventos | Google Calendar (solo lectura) | Importación, revisiones y salud de sincronización |
| Memorias derivadas | Aplicación | Fechas, fuentes, versiones e historia |

Sin sincronización bidireccional automática en el MVP. Las modificaciones salen
como **propuestas Markdown revisables** (`vault-proposals/`) y nunca sobrescriben
una nota más reciente: `checkProposal` compara el hash base con la nota actual.

## Rutas de construcción

| Ruta | Fuentes | Comportamiento |
|---|---|---|
| Local | Vault y archivos seleccionados en el Mac | Consultar originales autorizados; desarrollar en este repositorio |
| Nube | Este repositorio + paquete de contexto | Desarrollar, probar y desplegar sin el Mac ni iCloud |

Esta primera iteración se construyó **en la nube sin paquete de contexto**:
estructura y pruebas con datos sintéticos; importación real y evaluación pendientes.

## MVP

Conversación principal, Today, resúmenes de proyectos y controles de fuente,
corrección, memoria y eliminación. Documentos seleccionados y Google Calendar de
solo lectura.

**Fuera del MVP:** correo completo, bancos, brókeres, operaciones financieras,
envíos automáticos, agentes permanentes y apps móviles nativas.

## Dominios candidatos

Santiago Fitness Method, consultoría de IA y trading. **Su estado no se ha
establecido**: se tomará exclusivamente de las fuentes seleccionadas.

## Supuestos

- Documentación en español.
- Solo se publica el contexto seleccionado y en espacios privados.
- Las integraciones requieren autorización propia de la aplicación; no se
  presupone acceso transferible desde otras herramientas.
