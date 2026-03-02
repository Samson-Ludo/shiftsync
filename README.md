# ShiftSync Monorepo (MVP)

Foundational end-to-end MVP for **ShiftSync**, a multi-location staff scheduling platform for **Coastal Eats**.

## Stack

- Frontend: Next.js Pages Router + TypeScript + Tailwind CSS + Socket.IO client
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
- `POST /shifts/:id/validate-assign/:staffId`
- `DELETE /shifts/:id/assignments/:assignmentId`
- `GET /staff?locationId=<id>`
- `POST /swap-requests` (placeholder, returns 501)
- `GET /analytics/schedule-health` (placeholder, returns 501)

## Frontend Architecture Rules

- Routing is Pages Router only (`apps/web/src/pages`).
- No Next.js API proxy routes are used.
- All backend calls from the web app go through `apps/web/src/lib/api` Axios wrappers.
- JWT is stored in browser `localStorage` for take-home speed/simplicity.
  - This is intentionally temporary and should be upgraded to httpOnly cookies in production.

## Assignment Concurrency Model

Assignment creation now uses a lock + transaction + revalidation sequence to prevent race conditions:

1. Acquire reservation lock in `Lock` collection with key `staff:{staffId}` and TTL ~15 seconds.
2. Start MongoDB transaction (Mongoose session).
3. Re-run `validateAssignment(...)` inside the same transaction/session.
4. Create `ShiftAssignment` and notifications in the transaction.
5. Commit transaction.
6. Release lock in `finally` (TTL remains as safety if release fails).

Conflict handling:

- If lock acquisition fails, API returns `409` with `code: "conflict_detected"` and emits `conflict_detected` to manager room `user:{userId}`.
- If revalidation fails inside transaction, API returns `409` with `code: "conflict_detected"` plus violations/suggestions, and emits `conflict_detected`.
- On success, API emits `assignment_created` to `location:{locationId}` so managers refresh without full page reload.

## RBAC Rules Implemented

- Admin: full visibility and management actions
- Manager: management actions restricted to assigned locations
- Staff: can only view published shifts for certified locations, plus their own assignments

## Manual Test Steps

1. Run seed and log in as manager (`maya.manager@coastaleats.com`).
2. Confirm web uses Pages routes:
   - `/login`, `/dashboard`, `/manager`, `/staff`, `/notifications`
3. Confirm API calls are direct to `NEXT_PUBLIC_API_BASE_URL` by checking the browser network tab (no `/api/*` requests).
4. In manager dashboard, switch locations and week start; confirm only assigned locations appear.
5. Select a shift in manager dashboard and test assignment constraints:
   - `Unavailable Test Shift` + `Ava Ramirez` => availability violation
   - `Brunch Rush` + non-barista staff => required skill violation
   - `Uncertified Test Shift` + NYC-only staff => location certification violation
   - `Conflict Candidate B` + `Mason Reed` => overlap violation (already assigned to `Conflict Candidate A`)
   - `Rest Gap Test Shift` + `Isabella Scott` => minimum rest violation after overnight shift
6. Confirm suggestions appear for failing validations and click one to preselect.
7. Confirm assign only works when validation is `ok: true`.
8. Use staff login and confirm dashboard only shows published schedule + own assignments.
9. Check notifications panel and mark an unread notification as read.
10. Call `POST /shifts/:id/unpublish` or `PATCH /shifts/:id` for a near-term shift and confirm 48h cutoff blocks it.
11. Concurrency test (two manager windows):
   - Open two browser windows and log in as managers who can access the same location.
   - Pick two different shifts and the same staff member.
   - Click **Confirm Assign** in both windows at nearly the same time.
   - Expected: exactly one request succeeds; the other returns `409 conflict_detected`.
   - Expected UI: losing manager immediately sees a conflict banner via Socket.IO, and successful assignment emits `assignment_created` causing live shift list refresh.

## Constraint Tests

Run minimal backend unit tests for temporal constraints:

```bash
npm run test:constraints -w apps/api
```

## Deployment Notes

- **Web (Netlify)**:
  - Build command: `npm run build -w apps/web`
  - Publish directory: `apps/web/.next`
  - Env vars: `NEXT_PUBLIC_API_BASE_URL`
- **API (Render)**:
  - Build command: `npm run build -w apps/api`
  - Start command: `npm run start -w apps/api`
  - Env vars: from `apps/api/.env.example`
- **MongoDB Atlas**:
  - Set `MONGODB_URI` to your Atlas connection string in Render.

## Notes / TODOs

- Assignment constraints now enforce overlap, minimum rest, required skill, certification, and availability windows.
- Overtime cap and labor law policy checks remain TODO for a later iteration.
- Pending swap request cancellation hooks are structured in place for edit/publish flows; richer notifications are TODO.
- No shared `packages/` types package added yet to keep MVP simple and avoid premature abstraction.
