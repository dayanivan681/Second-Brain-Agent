# Validación de OpenAI aislada

## Cambios y alcance

- Vitest pasa de 3.2.7 a 5.0.3 para resolver los avisos de Vitest,
  @vitest/mocker y tinypool detectados por npm audit.
- El adaptador de Chat Completions mantiene store: false y configura Luna con
  reasoning_effort: none. Cada petición tiene un timeout de 30 segundos.
- El CI comprueba también la auditoría de dependencias: un check verde ya no
  omite vulnerabilidades de severidad moderada o superior.
- La validación importa solo el paquete seleccionado en memoria, sin
  DATABASE_URL, embeddings, MCP remoto ni escrituras en el Vault.
  No valida el circuito Agents API → MCP → Supabase descrito en prueba-agente.md.

## Secretos y ejecución

El workflow OpenAI manual validation es exclusivamente workflow_dispatch: no
tiene schedule ni se ejecuta en pull_request. Usa el entorno separado
second-brain-evaluation y el secreto OPENAI_EVAL_API_KEY, que solo se inyecta
como OPENAI_API_KEY en el paso de llamadas reales. Los tests y npm ci no
reciben esa variable. El briefing diario usa otro secreto (OPENAI_API_KEY).
No configurar el secreto del briefing para hacer esta prueba.

La conexión de GitHub usada para preparar este cambio no permite administrar
Secrets. La persona administradora debe guardar la clave mediante la interfaz
segura de GitHub en second-brain-evaluation. Nunca compartirla en chat, issues,
commits, logs o archivos de contexto. Preferir una clave de proyecto limitada
a la evaluación, con permisos mínimos y límites de consumo adecuados.

El workflow manual estará disponible cuando el archivo exista en main. Elegir
explícitamente la rama/commit revisado al ejecutarlo. Antes de añadir el secreto,
revisar el código del workflow y configurar restricciones del entorno si están
disponibles. La ejecución realiza llamadas facturables a OpenAI.

## Comprobación sin red

```bash
npm run evaluate:live -- --dry-run
```

Comprueba manifiesto, hashes, rutas, secretos detectables y preguntas. No llama
a OpenAI ni demuestra calidad del modelo. Las fuentes deben tener viñetas en
secciones reconocidas por extractDrafts: Objetivos, Reglas, Decisiones o Estado.

## Prueba sintética con el modelo real

Ejecutar OpenAI manual validation tras configurar el secreto. Usa las seis
preguntas existentes y guarda respuestas sintéticas durante siete días como
artifact. Los logs solo contienen resumen, latencia en el informe y tokens;
no imprimen la clave ni las respuestas. Ante un error del proveedor, se detiene
la batería y guarda solo un código de error genérico.

Cada respuesta necesita al menos una herramienta ejecutada correctamente,
citas a las fuentes esperadas y ninguna escritura. El resumen structurallyValid
no juzga si el texto interpreta bien la fuente. Las respuestas y su archivo
de revisión requieren lectura individual. Las preguntas sintéticas nunca
aprueban la fase real, aunque todas reciban un veredicto positivo.

## Evaluación de contexto real

Solo después de seleccionar las fuentes autorizadas: un paquete validado con
synthetic: false y 30–50 preguntas con respuesta esperada y sourceIds. Todas las
entradas y preguntas deben tener synthetic: false. Incluir estado actual,
historia, correcciones, decisiones revertidas, eliminación, permisos y lagunas.
No marcar fixtures sintéticos como reales para obtener una aprobación.

Con la clave inyectada por un gestor de secretos, ejecutar:

```bash
npm run evaluate:live -- --package context/private/vault --questions context/private/evaluation.json --output evaluation-results/real.local.json
```

La ejecución envía a OpenAI preguntas y memorias recuperadas del paquete
seleccionado. store: false no elimina los registros de supervisión de abuso.
Los informes incluyen contenido seleccionado: se ignoran por Git, se crean
con permisos restringidos y no deben subirse a artifacts ni compartirse sin
revisión. El archivo de salida debe ser nuevo: no se sobrescribe un informe.

Revisar cada respuesta contra sus fuentes y rellenar correct con true/false en
el archivo de revisión creado junto al informe. No editar el informe original.
Después:

```bash
npm run evaluate:score -- evaluation-results/real.local.json evaluation-results/real.local.json.review.local.json
```

El score exige revisión completa, al menos 90 % de respuestas correctas con
evidencia y cero fallos críticos. Un resultado sintético nunca pasa. La
evaluación no prueba controles de acceso de producción ni valida mecanismos
de corrección histórica que no estén presentes en el paquete seleccionado.

## Estado de preparación

El código y los tests del arnés pueden validarse sin clave. Las llamadas reales
y la evaluación de contexto personal permanecen pendientes hasta disponer de
la clave mediante el flujo seguro y del paquete real seleccionado. No habilitar
automatizaciones ni usar resultados como decisiones personales antes de revisarlos.
