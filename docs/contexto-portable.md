# Paquete de contexto portable

Permite construir y evaluar en la nube sin acceso al Mac. **Nunca se versiona en
este repositorio** (`context/private/` está en `.gitignore`); se entrega por un
canal privado.

## Contenido

```
paquete/
  manifest.json          # generado con scripts/build-manifest.mjs
  plan.md                # este plan o su versión vigente
  reglas/…               # reglas aplicables
  decisiones/…           # decisiones registradas
  proyectos/…            # SOLO las notas seleccionadas
  evaluation.json        # 30–50 preguntas (mismo formato que fixtures/synthetic/evaluation.json)
```

## Reglas

- Rutas relativas: nada de rutas absolutas del Mac, carpetas de iCloud, `~` ni `..`.
- Solo fuentes seleccionadas. Excluir secretos y archivos personales innecesarios.
- Cada entrada del manifiesto: `id`, `path`, `sha256`, `capturedAt`,
  `originalNote` (ruta relativa al Vault), `version` (p. ej. `updated`), `domain`,
  `synthetic: false`.
- Las notas importables usan secciones `## Objetivos`, `## Reglas`,
  `## Decisiones`, `## Estado` (o sus equivalentes en inglés) con viñetas.

## Generar y verificar

```bash
node scripts/build-manifest.mjs ruta/al/paquete pis-2026-10-XX
```

`verifyManifestFiles` rechaza rutas no portables, hashes que no coinciden,
archivos ausentes y secretos detectables.

## Preguntas de evaluación

Cada pregunta: `id`, `question`, `lang` (`es`/`en`/`spanglish`), `kind`
(`current`, `historical`, `correction`, `reverted-decision`, `deletion`,
`permissions`, `missing-data`), `expected`, `evidence` (ids del manifiesto),
`critical`, `synthetic`. Documentar también las **lagunas**: preguntas que hoy
no tienen fuente.
