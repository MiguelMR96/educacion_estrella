# Bitácora de trabajo con IA

Todo el desarrollo se hizo con **Claude Code**, con el enunciado de la prueba como único
input inicial. Documento aquí qué se pidió, qué no funcionó a la primera, qué se corrigió
y por qué, y qué decisiones tomé yo conscientemente en vez de aceptar la propuesta inicial.

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

Backend (Node/TS, Lambda) → infraestructura (CDK) → frontend (React/Vite) → despliegue real
en mi cuenta de AWS → verificación end-to-end en el navegador contra esa infraestructura →
documentación.

## Bugs reales encontrados — antes de desplegar

Estos salieron corriendo `cdk synth`, tests y typecheck localmente, antes de tener
credenciales de AWS:

- **Bundling de Lambda con CDK**: `NodejsFunction` fallaba con `PathNotUnderRoot` porque el
  código del backend vive en `backend/` y el proyecto CDK en `infra/` — carpetas hermanas,
  no una dentro de otra. Se corrigió pasando `projectRoot` y `depsLockFilePath` explícitos.
- **Región por defecto equivocada**: el synth generaba recursos en `us-west-2` (la región
  por defecto de mi perfil de AWS) en vez de `us-east-1` (la que sugiere el enunciado). Se
  fijó explícitamente en `bin/app.ts` en vez de heredar el perfil local, para que el deploy
  sea reproducible sin importar la máquina.
- **Servidor local de desarrollo**: el wrapper de Express que reusa los handlers de Lambda
  tenía un error de tipos al invocar el handler. Se corrigió el llamado.
- **Cookie de sesión en local**: la cookie está pensada como `SameSite=None; Secure`
  (necesaria en producción porque frontend y API viven en dominios distintos), pero el
  navegador la descarta silenciosamente sobre HTTP plano en `localhost`. Se agregó un flag
  que relaja esto solo en desarrollo.

## Bugs reales encontrados — probando la app ya desplegada

Esta fue la parte más valiosa de la sesión: varios de estos solo aparecieron al usar la
app de verdad contra AWS real, no en pruebas locales ni en `cdk synth`.

- **Login/registro devolvía 500 en vez de un error controlado.** Causa raíz: en
  `handlers/auth.ts` y `handlers/applications.ts`, las rutas hacían `return login(event)`
  en vez de `return await login(event)` dentro del `try`. Como `login()` es `async`,
  retornar la promesa sin esperarla hace que el `catch` del handler no alcance a atrapar un
  error lanzado después del primer `await` interno — la excepción se escapa como fallo no
  controlado de Lambda (que API Gateway convierte en 500) en vez del JSON 401/400 esperado.
  Lo encontré probando login con contraseña incorrecta y viendo un 500 en vez del mensaje
  de error. Confirmé la causa leyendo los logs de CloudWatch, y verificamos el fix con una
  prueba que falla contra el código viejo y pasa contra el nuevo.
- **El secreto JWT se regeneraba en cada `cdk deploy`**, incluso en deploys que no tocaban
  nada relacionado con autenticación. Estaba generado con `crypto.randomBytes` en tiempo de
  síntesis de CDK, así que cada deploy invalidaba silenciosamente todas las sesiones
  activas. Lo descubrí porque, al redesplegar el fix anterior, mi propia sesión de prueba
  quedó inválida a mitad de la verificación. Se cambió a una derivación determinística
  (hash de cuenta + nombre del stack + un salt fijo), verificada corriendo `cdk synth` dos
  veces y comparando que el valor generado sea idéntico.
- **El botón "Reintentar" del formulario no hacía nada visible.** Solo cambiaba una
  variable de fase interna pero nunca limpiaba el mensaje de error, así que el banner rojo
  se quedaba en pantalla para siempre y no se reintentaba nada. Se corrigió para que
  también limpie el estado de error.
- **CORS duplicado en tres capas** (API Gateway, el servidor local de Express, y los
  propios Lambdas) causaba que, si faltaba una variable de entorno, el manejador de errores
  necesitara esa misma variable para responder — un fallo en cascada. Se quitó el manejo de
  CORS de los Lambdas, dejándolo solo donde realmente pertenece (API Gateway en producción,
  Express en local).

## Qué revisé/cuestioné yo

- **DynamoDB vs. RDS**: le pregunté directamente por qué DynamoDB si yo conozco mucho mejor
  RDS/SQL. Me explicó los patrones de acceso fijos de esta app, el problema de meter Lambda
  en una VPC para hablar con RDS (NAT Gateway no es gratis), y que el Free Tier de RDS
  caduca a los 12 meses mientras que el de DynamoDB on-demand no. Acepté el argumento, pero
  fue una decisión que discutimos, no algo que yo aceptara sin más.
- **Verifiqué en vivo, no solo leí el código**, que el bucket de videos sea realmente
  privado: pedí el objeto sin credenciales directo a su URL de S3 y confirmé `403 Access
  Denied`, además de revisar `BlockPublicAccess.BLOCK_ALL` con el CLI.
- **Cuestioné cómo un analista vería el video** ya que no hay panel de administración
  (fuera de alcance según el enunciado). La respuesta honesta: hoy nadie puede verlo desde
  la app — solo alguien con acceso a la cuenta de AWS, vía consola o CLI.
- **Le pedí que no usara `AdministratorAccess` sin explicarlo**: el usuario IAM que despliega
  sí lo tiene (CDK necesita crear roles de varios servicios), pero cada Lambda en tiempo de
  ejecución tiene permisos acotados a su propia tabla/bucket — le pedí que esa distinción
  quedara documentada explícitamente en el README, no dada por sentada.

## Estado final

El código está desplegado y funcionando en AWS real (no es una demo local): registro,
login, formulario con subida de video a S3 (validación de tipo/tamaño en cliente y
servidor), listado de solicitudes, y logout, todo verificado contra DynamoDB/S3/Lambda/API
Gateway reales, incluyendo los bugs encontrados y corregidos arriba.

## Limitaciones conocidas

- Sin panel de análisis/revisión de video (fuera de alcance explícito del enunciado).
- Sesión sin revocación antes de su expiración (7 días) — ver README para el trade-off
  completo.
- Sin emulador local para DynamoDB/S3 — el desarrollo local requiere apuntar a recursos ya
  desplegados en AWS.
