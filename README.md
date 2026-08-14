# Educación Estrella — Solicitud de crédito con entrevista en video

Prueba técnica full stack. Flujo mínimo pero funcional: registro/login, formulario de
solicitud de crédito con subida de video de entrevista, y consulta de solicitudes propias.

## 1. Arquitectura

```
                         ┌─────────────────────────┐
                         │   S3 (sitio estático)    │
  Navegador  ───GET───▶  │  frontend build (Vite)   │
                         └─────────────────────────┘
                                      │
                                      │ fetch (credentials: include)
                                      ▼
                         ┌─────────────────────────┐
                         │  API Gateway (HTTP API)  │
                         └─────────────────────────┘
                            │                  │
                            ▼                  ▼
                 ┌────────────────┐   ┌─────────────────────┐
                 │ Lambda: auth    │   │ Lambda: applications │
                 │ (register/     │   │ (upload-url/create/  │
                 │  login/logout/ │   │  list)                │
                 │  me)           │   └─────────────────────┘
                 └────────────────┘        │        │
                       │                   │        │
                       ▼                   ▼        ▼
                ┌─────────────┐   ┌───────────────┐ ┌──────────────────┐
                │ DynamoDB     │   │ DynamoDB       │ │ S3 (videos,      │
                │ Users        │   │ Applications   │ │ privado)          │
                └─────────────┘   └───────────────┘ └──────────────────┘
                                                              ▲
                                                              │ PUT directo
                                                              │ (presigned POST)
                                                       Navegador (sube el video
                                                       sin pasar por Lambda)
```

Todo se define en AWS CDK (`infra/`) como una única stack (`EducacionEstrellaStack`),
en `us-east-1`, dentro de los límites del Free Tier.

**Subida de video:** el navegador nunca sube el archivo a través de Lambda/API Gateway
(el límite de payload de API Gateway HTTP API es de 10 MB, muy por debajo de los 200 MB
permitidos). En su lugar:

1. El frontend valida tipo y tamaño del archivo localmente.
2. Pide al backend una URL prefirmada (`POST /applications/upload-url`), que genera un
   **S3 presigned POST** con condiciones (`content-length-range`, `Content-Type`) — S3
   rechaza el archivo si excede 200 MB o no es `.mp4`/`.webm`, sin gastar ancho de banda
   de Lambda.
3. El navegador sube el archivo directo a S3 vía `XMLHttpRequest` (para poder mostrar
   progreso), con manejo explícito de error/corte de conexión/cancelación.
4. Al terminar, el frontend llama `POST /applications` con los datos del formulario y la
   referencia (`videoKey`) al objeto subido. El backend valida esos datos con Zod y hace
   un `HeadObject` a S3 para confirmar que el archivo realmente existe antes de crear el
   registro — así un cliente que "miente" sobre una subida exitosa no puede crear
   solicitudes fantasma.

## 2. Cómo levantar el proyecto localmente

Requiere Node 20+ y credenciales de AWS configuradas (`aws configure`) — el backend local
usa las tablas DynamoDB y el bucket S3 reales (no hay emulador local incluido; ver
Limitaciones). Lo más simple es desplegar una vez (sección 4) y luego apuntar el backend
local a esos recursos.

```bash
# Backend (puerto 3001)
cd backend
npm install
cp .env.example .env   # completa USERS_TABLE / APPLICATIONS_TABLE / VIDEOS_BUCKET
                        # con los nombres reales que imprime `cdk deploy`
npm run dev

# Frontend (puerto 5173), en otra terminal
cd frontend
npm install
cp .env.example .env.local   # VITE_API_URL=http://localhost:3001
npm run dev
```

Usamos `.env` (vía `dotenv`) en vez de variables inline (`VAR=x npm run dev`) porque esa
sintaxis no funciona en PowerShell/cmd — solo en shells POSIX. Si falta alguna variable
requerida, el servidor lo dice explícitamente al arrancar y no continúa.

### Pruebas

```bash
cd backend && npm test        # vitest: validación (zod) y auth (hash/JWT)
cd frontend && npm run typecheck
cd infra && npm run build && npx cdk synth
```

## 3. Despliegue en AWS

```bash
./deploy.sh
```

El script (ver comentarios en el archivo) hace un **deploy en dos pasadas**: la primera
crea la API (necesaria para obtener su URL), la segunda reconstruye el frontend con
`VITE_API_URL` apuntando a esa API y sincroniza el build real al bucket S3. Requiere
`aws configure` con una cuenta con permisos para crear los recursos (CDK bootstrap +
DynamoDB + S3 + Lambda + API Gateway + IAM).

## 4. Decisiones técnicas

| Decisión | Por qué |
|---|---|
| **Lambda + API Gateway HTTP API** (no Fargate) | Fargate no es parte del Free Tier (cobra por vCPU/hora incluso idle); Lambda + HTTP API sí (1M requests/mes gratis). Para el tráfico de una prueba técnica, cold starts son aceptables. |
| **JWT propio en cookie httpOnly** (no Cognito) | Cognito añade una capa de configuración (user pool, app client, hosted UI o SDK) que no aporta al alcance pedido. Un JWT firmado con `jsonwebtoken` + `bcryptjs`, en cookie `HttpOnly; Secure; SameSite=None` (cross-origin porque frontend y API viven en dominios distintos) da control total sobre cada pieza del mecanismo de sesión. Trade-off: sin rotación de secreto ni revocación de sesión individual — con más tiempo usaría refresh tokens rotables. |
| **DynamoDB** (no RDS) | Sin servidor que mantener, tier gratuito generoso (25 GB), y el modelo de datos (usuarios por email, solicitudes por usuario) no necesita relaciones ni transacciones complejas — encaja bien con un diseño de tablas simple sin sobre-diseñar un esquema single-table. |
| **S3 presigned POST para el video** (no subir vía Lambda) | Evita el límite de payload de API Gateway (10 MB) y evita pagar/gastar tiempo de ejecución de Lambda moviendo 200 MB. S3 aplica los límites de tipo/tamaño directamente vía condiciones de la policy. |
| **Secreto JWT como variable de entorno de Lambda** (no Secrets Manager) | Secrets Manager cobra pasados los primeros 30 días; SSM `SecureString` no se puede crear vía CloudFormation. Se deriva de forma **determinística** (SHA-256 de cuenta + nombre del stack + salt fijo) en el CDK y se inyecta como env var (cifrada en reposo con la KMS key gestionada de Lambda, sin costo). No es aleatorio a propósito: una versión aleatoria generada en cada síntesis regeneraba el secreto en *cada* `cdk deploy` — incluso deploys que no tocaban auth — invalidando todas las sesiones activas cada vez (bug real encontrado probando en vivo). Con más tiempo/presupuesto: Secrets Manager con rotación. |
| **S3 website hosting para el frontend** (no CloudFront) | Evita esperar el aprovisionamiento de una distribución CloudFront (~15-20 min) y mantiene el despliegue gratuito y rápido. Trade-off explícito: sin HTTPS propio, sin dominio custom, sin CDN/caché — con más tiempo agregaría CloudFront + OAC. |
| **Stack única de CDK** (frontend + backend juntos) | Simplifica `deploy`/`destroy` a un solo comando bajo presión de tiempo. En un sistema real separaría el stack del frontend (que cambia mucho más seguido) del backend. |
| **Un Lambda por dominio** (`auth`, `applications`), no uno por ruta | Balance entre granularidad de IAM/escalado (un Lambda por ruta) y simplicidad de despliegue. Cada handler enruta internamente por método+path. |
| **Vite + React Router**, sin Next.js | La app es una SPA pura detrás de una API — no hay necesidad de SSR/rutas de servidor, y evita la complejidad de decidir dónde correr el server-side de Next.js dentro del Free Tier. |

## 5. Seguridad

- El bucket de videos bloquea todo acceso público (`BlockPublicAccess.BLOCK_ALL`) y
  fuerza SSL; el único acceso es vía URLs prefirmadas de corta duración (5 min para
  subir).
- El bucket del frontend permite lectura pública **solo** de los assets estáticos
  compilados — nunca contiene secretos ni datos de usuarios.
- Todas las rutas de `/applications/*` exigen una cookie de sesión válida
  (`requireSession`); sin ella, 401.
- Validación de esquema (Zod) en el servidor para *todos* los inputs — el cliente valida
  para dar feedback rápido, pero el servidor es la fuente de verdad.
- Contraseñas con `bcrypt` (factor 10), nunca en texto plano ni logueadas.
- IAM de mínimo privilegio **en tiempo de ejecución**: cada Lambda solo tiene permisos
  sobre su propia tabla/bucket (`grantReadWriteData`, `grantPut`/`grantRead` puntual) —
  ninguna tiene `AdministratorAccess` ni acceso a recursos que no le corresponden.
- El usuario IAM usado **para desplegar** (`aws configure` en la laptop, el que corre
  `cdk deploy`) sí tiene `AdministratorAccess`, porque CDK necesita crear roles, políticas
  y recursos de varios servicios. Es un trade-off consciente para una cuenta personal de
  un solo desarrollador bajo esta fecha límite — en un equipo real ese usuario de deploy
  también se limitaría (p. ej. vía un rol de CI/CD con permisos acotados a los servicios
  que la stack usa).
- Nada de credenciales ni secretos versionados; el secreto JWT se deriva de forma
  determinística en cada `cdk deploy` (mismo valor siempre, ver sección 4), no vive
  en el repo ni en ningún archivo versionado.

## 6. Limitaciones conocidas y qué haría distinto con más tiempo

- **Sin emulador local para DynamoDB/S3**: el dev local requiere credenciales de AWS
  reales apuntando a recursos ya desplegados. Con más tiempo integraría
  `dynamodb-local`/LocalStack para desarrollo 100% offline.
- **Sesión sin revocación**: el JWT es válido hasta que expira (7 días); no hay forma de
  invalidar una sesión robada antes de eso. Añadiría una tabla de sesiones o refresh
  tokens rotables.
- **Objetos S3 huérfanos**: si el usuario sube el video pero nunca completa
  `POST /applications` (cierra la pestaña, por ejemplo), el objeto queda en S3 sin
  referencia en DynamoDB. Añadiría una regla de ciclo de vida que expire objetos sin
  confirmar tras N días.
- **Sin CloudFront**: el frontend se sirve por S3 website hosting — sin HTTPS propio ni
  CDN. Lo añadiría para producción real.
- **Un solo entorno**: no hay separación dev/staging/prod en la infraestructura.
- **Video no legible por el equipo de análisis en este alcance**: se guarda la referencia
  (`videoKey`) pero no se construyó un panel de revisión (explícitamente fuera de
  alcance según el enunciado).
