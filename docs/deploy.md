# Deployment Guide (Render + Netlify + Atlas)

## Overview

- API: Render Web Service (`apps/api`)
- Web: Netlify Site (`apps/web`)
- Database: MongoDB Atlas

## 1) MongoDB Atlas

1. Create an Atlas project and cluster.
2. Create a DB user with read/write access.
3. In Network Access:
   - add `0.0.0.0/0` during initial bring-up, then tighten to Render egress ranges if needed.
4. Copy connection string and set DB name to `shiftsync` (or your preferred name).

Example:

```env
MONGODB_URI=mongodb+srv://<user>:<pass>@<cluster>/shiftsync?retryWrites=true&w=majority
```

## 2) Render API Setup

Service settings:

- Root directory: repo root
- Build command: `npm run build -w apps/api`
- Start command: `npm run start -w apps/api`

Required env vars:

```env
PORT=4000
MONGODB_URI=<atlas-connection-string>
JWT_SECRET=<strong-random-secret>
JWT_EXPIRES_IN=8h
CLIENT_ORIGIN=<your-netlify-site-url>
CUTOFF_HOURS=48
```

Notes:

- `CLIENT_ORIGIN` must match Netlify URL exactly (scheme + host).
- If you use a custom domain, update both Netlify domain and `CLIENT_ORIGIN`.

## 3) Netlify Web Setup

Site settings:

- Base directory: repo root
- Build command: `npm run build -w apps/web`
- Publish directory: `apps/web/.next`

Environment variable:

```env
NEXT_PUBLIC_API_BASE_URL=<your-render-api-url>
NEXT_PUBLIC_APP_NAME=ShiftSync
```

Notes:

- Frontend calls API directly; no Next API proxy is used.
- Ensure Render API CORS `CLIENT_ORIGIN` includes this Netlify URL.

## 4) Production Seed

Run once after API deploy using your deployment environment variables:

```bash
npm run seed -w apps/api
```

Seed characteristics:

- resets demo collections for deterministic demos
- includes swap/drop/overtime/fairness/audit scenarios
- safe for demo reset workflows

## 5) Post-Deploy Smoke Check

1. Open web `/login`, authenticate with seeded account.
2. Manager path:
   - `/manager`
   - `/overtime`
   - `/fairness`
3. Verify API endpoints:
   - `GET /health`
   - `GET /reports/overtime`
   - `GET /reports/fairness`
   - `GET /audit/export` (admin token)

## 6) Demo Accounts

- Admin: `admin@coastaleats.com` / `Pass123!`
- Manager: `maya.manager@coastaleats.com` / `Pass123!`
- Staff: `ava.staff@coastaleats.com` / `Pass123!`

