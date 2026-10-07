# Propuestas para el Vault — 2026-10-07

Cambios **revisables**, generados en la nube sin acceso al Vault. No se aplican
solos. Copiar a mano tras revisar.

| Archivo propuesto | Ruta en el Vault | Tipo | Hash base |
|---|---|---|---|
| `vault/02 Areas/Projects/Personal Intelligence System.md` | igual | Nota nueva | — (no debe existir) |
| `vault/03 Logs/2026-10-07 Personal Intelligence System.md` | igual | Nota nueva | — (no debe existir) |
| Enlace en el índice de proyectos | nota de índice existente | Inserción | Desconocido: revisar a mano |
| Enlace en el Centro de Mando | nota existente | Inserción | Desconocido: revisar a mano |

## Antes de aplicar

1. Si alguna de las notas nuevas **ya existe** en el Vault, es un conflicto: no
   sobrescribir; fusionar a mano.
2. Ajustar el nombre de la nota del log a la convención real de `03 Logs` si es
   distinta (no se pudo consultar).
3. Comprobar que las propiedades (`type`, `status`, `updated`, `tags`) coinciden
   con las que usan las demás notas de proyecto.

## Inserciones en notas existentes

No se conocen el nombre ni el contenido actual del índice de proyectos ni del
Centro de Mando. Añadir donde corresponda:

**Índice de proyectos**

```markdown
- [[Personal Intelligence System]] — planificación · sistema privado de memoria y recomendaciones con evidencia
```

**Centro de Mando**

```markdown
- [[Personal Intelligence System]] — fase 1: preparar paquete de contexto portable
```

## Verificación tras aplicar

- [ ] Los enlaces `[[Personal Intelligence System]]` y `[[2026-10-07 Personal Intelligence System]]` resuelven
- [ ] La nota aparece en las consultas/vistas de proyectos que filtran por `type: project`
- [ ] Ninguna nota existente perdió contenido
