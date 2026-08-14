#!/usr/bin/env bash
# Two-pass deploy: the frontend needs the API URL baked in at build time
# (Vite env vars are compile-time), but the API URL only exists after the
# backend stack is deployed. So: deploy once with a placeholder frontend
# build to create the API, read its URL from the stack outputs, rebuild the
# frontend pointed at that URL, then deploy again to sync the real build.
set -euo pipefail
cd "$(dirname "$0")"

echo "== 1/5 Instalando dependencias =="
(cd backend && npm install)
(cd infra && npm install)
(cd frontend && npm install)

echo "== 2/5 Bootstrap + primer deploy (crea la API) =="
mkdir -p frontend/dist && [ -f frontend/dist/index.html ] || echo "placeholder" > frontend/dist/index.html
(cd infra && npx cdk bootstrap && npx cdk deploy --require-approval never --outputs-file outputs.json)

API_URL=$(node -e "console.log(require('./infra/outputs.json').EducacionEstrellaStack.ApiUrl)")
echo "API URL: $API_URL"

echo "== 3/5 Build del frontend con la URL real de la API =="
echo "VITE_API_URL=$API_URL" > frontend/.env.production
(cd frontend && npm run build)

echo "== 4/5 Segundo deploy (sube el build real a S3) =="
(cd infra && npx cdk deploy --require-approval never --outputs-file outputs.json)

echo "== 5/5 Listo =="
node -e "const o=require('./infra/outputs.json').EducacionEstrellaStack; console.log('Frontend:', o.FrontendUrl); console.log('API:', o.ApiUrl);"
