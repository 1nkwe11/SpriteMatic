# SpriteMatic

AI Sprite & Sprite Sheet Generator SPA with secure auth, GPT image generation, queueing, storage, and export tooling.

## Stack Decision (Implemented)

- Frontend: React + Vite + TypeScript + Tailwind CSS + Zustand + React Router + Axios
- Backend: Node.js + Express + TypeScript + Zod + JWT (HttpOnly cookies) + bcrypt + rate limiting + CSRF protection
- Database: PostgreSQL + Prisma ORM
- Queue/Caching: Redis + BullMQ
- Image: OpenAI Images API (`gpt-image-1` by default) + S3-compatible storage (MinIO/S3)

## Project Structure

```txt
.
├─ apps/
│  ├─ backend/
│  │  ├─ prisma/schema.prisma
│  │  ├─ src/app.ts
│  │  ├─ src/server.ts
│  │  ├─ src/worker.ts
│  │  ├─ src/routes/auth.routes.ts
│  │  ├─ src/routes/generate.routes.ts
│  │  ├─ src/services/sprite.service.ts
│  │  └─ .env.example
│  └─ frontend/
│     ├─ src/App.tsx
│     ├─ src/pages/
│     ├─ src/stores/
│     ├─ src/api/
│     └─ .env.example
├─ docker-compose.yml
├─ package.json
└─ README.md
```

## Local Setup

1. Install dependencies:
```bash
npm install
```

2. Start local infra:
```bash
docker compose up -d
```

3. Configure environment files:
- Copy `apps/backend/.env.example` -> `apps/backend/.env`
- Copy `apps/frontend/.env.example` -> `apps/frontend/.env`

4. Generate Prisma client + run migrations:
```bash
npm run prisma:generate --workspace @spritematic/backend
npm run prisma:migrate --workspace @spritematic/backend
```

5. Start both apps:
```bash
npm run dev
```

Frontend: `http://localhost:5173`  
Backend: `http://localhost:4000`

## Environment Templates

- Backend template: `apps/backend/.env.example`
- Frontend template: `apps/frontend/.env.example`

## DB Schema

Primary schema is in `apps/backend/prisma/schema.prisma` and includes:

- `User` (`id`, `email`, `passwordHash`, `role`, `createdAt`, limit fields)
- `RefreshToken` (hashed token records for JWT refresh rotation)
- `SpriteGeneration` (full prompt, params, model version, seed, status, image key/url, JSON config, warnings)

## API Routes

### Auth

- `GET /api/auth/csrf-token`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `POST /api/auth/refresh`
- `GET /api/auth/me`

### Generation

- `POST /api/generate/sprite`
- `GET /api/generate/jobs/:generationId`
- `GET /api/generate/history`
- `GET /api/generate/:id`
- `POST /api/generate/:id/regenerate`
- `DELETE /api/generate/:id`

## Example GPT Image Call

From `apps/backend/src/services/sprite.service.ts`:

```ts
const imageResponse = await openai.images.generate({
  model: env.OPENAI_IMAGE_MODEL,
  prompt,
  background: "transparent",
  output_format: "png",
  quality: "high",
  size: "1024x1024",
  user: userId
});
```

Prompt is auto-constructed with strict sprite constraints and user theme before calling the API.

## Fine-Tuning + Weights & Biases

Sprite generation uses Images API, but backend config now supports W&B metadata for fine-tuning jobs:

- `OPENAI_FINE_TUNE_WANDB_PROJECT`
- `OPENAI_FINE_TUNE_WANDB_ENTITY` (optional)
- `OPENAI_FINE_TUNE_WANDB_TAGS` (comma-separated, optional)

Implementation helper:

- `apps/backend/src/services/fine-tuning.service.ts`

Use `withFineTuneWandbIntegration({ params, runName })` before calling
`openai.fineTuning.jobs.create(params)` in your fine-tune workflow.

Note: The W&B API key used by OpenAI fine-tuning integration is configured in the OpenAI dashboard.
Do not commit private API keys into source control.

## JSON Export Format

Returned per generation in `jsonConfig`:

```json
{
  "kind": "sprite-sheet",
  "frameWidth": 64,
  "frameHeight": 64,
  "columns": 12,
  "rows": 1,
  "animations": {
    "walk": {
      "start": 0,
      "end": 11,
      "loop": true
    }
  }
}
```

## Deployment

### Frontend (Vercel/Netlify)

- Root directory: `apps/frontend`
- Build command: `npm run build --workspace @spritematic/frontend`
- Output directory: `apps/frontend/dist`
- Env: `VITE_API_BASE_URL=<public-backend-url>/api`

### GoDaddy Domain Mapping (`spritematic.com`)

Use GoDaddy as DNS/registrar and point records to your actual app hosts:

- `A`/`ALIAS` `@` -> frontend host target
- `CNAME` `www` -> frontend host target
- `CNAME` `api` -> backend host target

Recommended production URLs:

- Frontend: `https://spritematic.com`
- Backend API: `https://api.spritematic.com`

Important: do not run production on plain `http://spritematic.com`.  
Auth uses secure HttpOnly cookies, so HTTPS is required for login/session cookies to work reliably.

### Backend (Railway/Render/Fly.io)

- Root directory: `apps/backend`
- Build command: `npm run build --workspace @spritematic/backend`
- Start command: `npm run start --workspace @spritematic/backend`
- Optional dedicated worker command: `npm run start:worker --workspace @spritematic/backend`
- Provision Postgres + Redis + S3-compatible bucket and set backend env vars.

### DB (Supabase/Neon)

- Set `DATABASE_URL`
- Run:
```bash
npm run prisma:deploy --workspace @spritematic/backend
```
