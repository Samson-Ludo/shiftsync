# ShiftSync Monorepo (MVP)

Foundational end-to-end MVP for **ShiftSync**, a multi-location staff scheduling platform for **Coastal Eats**.

## Stack

- Frontend: Next.js App Router + TypeScript + Tailwind CSS + Socket.IO client
- Backend: Express + TypeScript + Mongoose + Zod + JWT + Socket.IO server
- DB: MongoDB Atlas
- Target deploys: Netlify (web), Render (api), MongoDB Atlas

## Repo Layout

- `apps/api`: Express API
- `apps/web`: Next.js web app

## Time Handling Decisions

- All shift times are stored in UTC in MongoDB (`startAtUtc`, `endAtUtc`).
- Shift creation/editing takes location-local inputs (`localDate`, `startLocalTime`, `endLocalTime`) and converts with Luxon.
- Overnight shifts are handled as one shift: if end time is <= start time, end is moved to the next day.
- UI/API responses also include location-local formatted output for display.
- Week grouping uses ISO Monday week start (`weekStartLocal`) in the location timezone.

## Local Setup

1. Install dependencies from repo root:

```bash
npm install
```

2. Configure environment variables:

- API: copy `apps/api/.env.example` to `apps/api/.env`
- Web: copy `apps/web/.env.example` to `apps/web/.env.local`

### API env template (`apps/api/.env`)

```env
PORT=4000
MONGODB_URI=mongodb+srv://<user>:<pass>@cluster.mongodb.net/shiftsync
JWT_SECRET=replace-with-strong-secret
JWT_EXPIRES_IN=8h
CLIENT_ORIGIN=http://localhost:3000
CUTOFF_HOURS=48
```

### Web env template (`apps/web/.env.local`)

```env
NEXT_PUBLIC_APP_NAME=ShiftSync
NEXT_PUBLIC_API_BASE_URL=http://localhost:4000
API_BASE_URL=http://localhost:4000
```

3. Seed database:

```bash
npm run seed
```

4. Run both apps in dev:

```bash
npm run dev
```

- Web: `http://localhost:3000`
- API: `http://localhost:4000`

## Workspace Scripts

- `npm run dev` - run api + web
- `npm run dev:api` - run only API
- `npm run dev:web` - run only web
- `npm run build` - build all workspaces
- `npm run seed` - seed MongoDB from `apps/api/src/seed.ts`

## Seed Data Coverage

Seed script (`apps/api/src/seed.ts`) provides:

- 4 locations across 2 time zones (`America/Los_Angeles`, `America/New_York`)
- 3 managers mapped to assigned locations
- 12 staff with mixed skills and location certifications
- Recurring weekly availability rules + 4 one-off availability exceptions
- Overnight shift: `23:00 -> 03:00` next day
- Hour-risk arrangement: one staff assigned 48h + extra 4h shift available (52h risk)
- Overlap conflict setup: two LA shifts that overlap for potential double-booking

## Test Login Credentials

All seeded users use password: `Pass123!`

- Admin: `admin@coastaleats.com`
- Manager: `maya.manager@coastaleats.com`
- Staff: `ava.staff@coastaleats.com`

## MVP API Surface

- `GET /health`
- `POST /auth/login`
- `GET /auth/me`
- `GET /notifications`
- `PATCH /notifications/:id/read`
- `POST /shifts`
- `GET /shifts?locationId&weekStart`
- `PATCH /shifts/:id`
- `POST /shifts/:id/publish`
- `POST /shifts/:id/unpublish`
- `POST /shifts/:id/assign`
- `DELETE /shifts/:id/assignments/:assignmentId`
- `POST /swap-requests` (placeholder, returns 501)
- `GET /analytics/schedule-health` (placeholder, returns 501)

## RBAC Rules Implemented

- Admin: full visibility and management actions
- Manager: management actions restricted to assigned locations
- Staff: can only view published shifts for certified locations, plus their own assignments

## Manual Test Steps

1. Run seed and log in as manager (`maya.manager@coastaleats.com`).
2. In manager dashboard, switch locations and week start; confirm only assigned locations appear.
3. Create a shift (including overnight pattern like `23:00` to `03:00`) and verify it appears.
4. Use staff login and confirm dashboard only shows published schedule + own assignments.
5. Check notifications panel and mark an unread notification as read.
6. Call `POST /shifts/:id/unpublish` or `PATCH /shifts/:id` for a near-term shift and confirm 48h cutoff blocks it.

## Deployment Notes

- **Web (Netlify)**:
  - Build command: `npm run build -w apps/web`
  - Publish directory: `apps/web/.next`
  - Env vars: `NEXT_PUBLIC_API_BASE_URL`, `API_BASE_URL`
- **API (Render)**:
  - Build command: `npm run build -w apps/api`
  - Start command: `npm run start -w apps/api`
  - Env vars: from `apps/api/.env.example`
- **MongoDB Atlas**:
  - Set `MONGODB_URI` to your Atlas connection string in Render.

## Notes / TODOs

- Assignment constraints (availability, overtime, double-booking checks) are intentionally deferred and marked TODO.
- Pending swap request cancellation hooks are structured in place for edit/publish flows; richer notifications are TODO.
- No shared `packages/` types package added yet to keep MVP simple and avoid premature abstraction.
