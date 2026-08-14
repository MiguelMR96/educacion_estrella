# Bitácora de trabajo con IA

Todo el desarrollo se hizo con **Claude Code**, en una sesión de trabajo enfocada, con el
enunciado de la prueba como único input inicial. Documento aquí qué se pidió, qué no
funcionó a la primera, qué se corrigió y por qué, y qué decisiones tomó la IA que yo
tuve que revisar/aceptar conscientemente.

## Punto de partida

Le pasé el PDF/markdown del enunciado completo y le pedí construir el proyecto de punta a
punta: autenticación, formulario con subida de video, consulta de solicitudes, backend
Lambda, infraestructura como código, y los entregables (README, este log). Antes de
escribir código, Claude Code preguntó tres cosas que sí eran bloqueantes y no podía
decidir por su cuenta:

1. Dónde crear el proyecto (mi carpeta `simpl` ya tenía otro proyecto no relacionado).
2. Cómo manejar que mis credenciales de AWS CLI estaban inválidas — decidí que construyera
   todo primero y dejáramos el despliegue real para el final.
3. Que no tenía `gh` instalado — decidí crear el repo de GitHub yo mismo manualmente.

Esto me pareció el comportamiento correcto: no adivinó credenciales ni intentó rutas que
no podía verificar, y todo lo demás (stack, lenguaje, Lambda vs. contenedor, Cognito vs.
JWT propio, DynamoDB vs. RDS) lo decidió y lo justificó por escrito en el README en vez de
preguntarme — que es exactamente lo que pide el enunciado ("documenta tu interpretación y
sigue adelante").

## Qué construyó y en qué orden

Backend (Node/TS, Lambda) → infraestructura (CDK) → frontend (React/Vite) → verificación →
documentación. Trabajó con una lista de tareas explícita (auth handler, applications
handler, dev server, CDK stack, frontend, docs) y fue marcando cada una según avanzaba,
lo cual hizo fácil verificar que no se saltara nada del alcance.

## Dónde su primera propuesta no funcionó

- **Bundling de Lambda con CDK**: al correr `cdk synth`, `NodejsFunction` falló con
  `PathNotUnderRoot` porque el código del backend vive en `backend/` y el proyecto CDK en
  `infra/` — carpetas hermanas, no una dentro de otra. La causa es que CDK infiere el
  `projectRoot` a partir de dónde corre `cdk`, y el entry point del Lambda quedaba fuera de
  ese árbol. Se corrigió pasando `projectRoot` y `depsLockFilePath` explícitos apuntando a
  `backend/`. No lo detecté yo — lo encontró la propia ejecución de `cdk synth`, que
  Claude Code corrió proactivamente antes de darlo por terminado.
- **Región por defecto equivocada**: el `cdk synth` inicial generó recursos en
  `us-west-2` en vez de `us-east-1` (la región sugerida por el enunciado), porque el
  código usaba `process.env.CDK_DEFAULT_REGION` y mi perfil local de AWS tiene esa región
  por defecto. Se corrigió fijando `us-east-1` de forma explícita en `bin/app.ts` en vez de
  heredar el perfil local — importante para que el despliegue sea reproducible sin
  importar en qué máquina se corra.
- **Servidor local de desarrollo**: el wrapper de Express que reusa los mismos handlers de
  Lambda (`backend/src/local.ts`) tenía un error de tipos (llamaba al handler con 3
  argumentos cuando el tipo inferido solo aceptaba 1) — típico de adaptar una firma de
  Lambda a una firma de Express a mano. Se corrigió eliminando los argumentos de más.
- **Cookie de sesión en desarrollo local**: la cookie de sesión se diseñó
  `SameSite=None; Secure` (necesario en producción porque el frontend y la API viven en
  dominios distintos), pero eso hace que el navegador la descarte silenciosamente cuando
  el API local corre sobre HTTP plano en `localhost`. Se agregó un flag `LOCAL_DEV` que
  relaja a `SameSite=Lax` sin `Secure` solo en desarrollo — decisión que yo verifiqué
  tiene sentido: es la única diferencia de comportamiento entre entornos y está aislada en
  un solo lugar (`backend/src/lib/auth.ts`).

## Qué revisé/descarté yo

- Verifiqué que el bucket de videos tenga `BlockPublicAccess.BLOCK_ALL` y que el único
  camino de escritura sea una URL prefirmada de 5 minutos — es la señal de seguridad más
  penalizada según el enunciado, así que la revisé línea por línea en vez de asumir que
  estaba bien.
- Cuestioné la elección inicial de subir el video a través de Lambda; Claude Code ya lo
  había descartado de entrada por el límite de payload de API Gateway (10 MB) y propuso
  presigned POST directo a S3 con validación de tamaño/tipo vía condiciones de la policy
  — lo acepté porque es la forma estándar de resolver esto y es defendible en la
  entrevista.
- Decidí no usar Cognito para no introducir una pieza de configuración (user pools, app
  clients) que no iba a poder explicar con la misma profundidad que un JWT propio escrito
  a mano.

## Lo que falta (honesto, no maquillado)

- **Despliegue real a AWS**: al momento de escribir esto, el código está completo y
  verificado localmente (`cdk synth`, tests, typecheck, y el frontend probado en
  navegador), pero el despliegue real con `./deploy.sh` requiere credenciales válidas de
  AWS que configuraré antes de la entrega.
- **Flujo end-to-end contra AWS real**: login → subir video → ver solicitud no se pudo
  probar contra DynamoDB/S3 reales en esta sesión por la misma razón (sin credenciales
  válidas); sí se verificó cada pieza por separado (tests del backend, render del
  frontend, `cdk synth` limpio).
