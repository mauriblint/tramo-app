# tramo

Planificá un viaje charlando: el copiloto pregunta lo justo, propone una ruta (ciudades y noches) y arma el itinerario día por día, que después se ajusta por chat.

- `backend/`: Express + TypeScript + SQLite (better-sqlite3) + OpenAI (Responses API, `gpt-6-luna`).
- `frontend/`: Vue 3 + Vite + Tailwind 4, instalable como PWA.

## Desarrollo

```bash
cp backend/.env.example backend/.env   # poner OPENAI_API_KEY
npm --prefix backend install && npm --prefix frontend install
npm --prefix backend run dev    # API en :3100 (SQLite en backend/data/)
npm --prefix frontend run dev   # web en :5180 (proxy /api → :3100)
```

## Deploy

Cada push a `main` corre `.github/workflows/deploy.yml`, que entra por SSH al servidor y ejecuta `sudo -n www-deploy tramo` → `/var/www/tramo/deploy` (sync con `origin/main`, build de backend y frontend, `pm2 restart tramo-api`).

Secrets del repo: `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`.

### Setup inicial del servidor (una sola vez)

```bash
cd /var/www && git clone git@github.com:mauriblint/tramo-app.git tramo
chown -R root:root /var/www/tramo && chmod 755 /var/www/tramo /var/www/tramo/deploy
cat > /var/www/tramo/backend/.env <<'ENV'
API_PORT=3012
API_HOST=127.0.0.1
DATABASE_URL=./data/tramo.db
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-6-luna
ENV
www-deploy tramo                                   # primer build + pm2 start
cp ops/nginx-tramo.conf /etc/nginx/sites-available/tramo   # editar SERVER_NAME
ln -s /etc/nginx/sites-available/tramo /etc/nginx/sites-enabled/tramo
printf "USUARIO:$(openssl passwd -apr1)\n" > /etc/nginx/tramo.htpasswd
nginx -t && systemctl reload nginx
```

La base vive en `backend/data/` (ignorada por git, `git clean -fd` no la toca).
