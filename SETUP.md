# Backend setup (Supabase)

The task builder itself needs no setup — `npm run dev` works with zero configuration.
Sharing, voting, events, results and rankings are backed by Supabase:

1. Create a free project at https://supabase.com (New Project — pick any name/region/password).
2. **SQL Editor → New query**, paste the whole of [`supabase/schema.sql`](supabase/schema.sql)
   and run it. The file is idempotent — re-run it in full any time it changes.
3. **Authentication → Providers**: confirm "Email" is enabled. **Authentication → URL
   Configuration**: add your dev URL (`http://localhost:3000`) and production URL
   (`https://nbparagliding.nz/vtasker/`) to the Redirect URLs allow-list — magic links
   will not work without this.
4. **Project Settings → API**: copy the "Project URL" and the "anon public" key.
5. Copy `.env.local.example` to `.env.local` and fill both values in.
6. Restart `npm run dev` (Vite only reads `.env.local` at startup).

Without `.env.local` the app still runs — the Sign In, Shared Tasks and Rankings buttons
are simply inert, and the map/task builder is unaffected.

## Optional: sample data

[`supabase/seed_test_data.sql`](supabase/seed_test_data.sql) adds three fake pilots, their
flight results on your first event, and five sample published tasks spread across the top of
the South Island — enough to make the discovery map, results table and rankings look real.

Run it **after** `schema.sql`, and after you have uploaded at least one flight of your own.
The fake pilots have no password and no real mailbox, so they cannot be signed into.
To remove everything it created:

```sql
delete from auth.users where email like '%@example.com';
delete from tasks where id::text like 'aaaa1111-%';
```

## How the pieces fit together

| Concept | What it is |
|---|---|
| **Task** | A reusable cylinder route. Publish it to share, and others can vote on it. |
| **Event** ("fly day") | One scheduled day flying a task. Has its own start time and pilot list. |
| **Confirming** | Explicitly saying "I'm competing" — separate from voting on the task. |
| **Start-time vote** | Any confirmed pilot can propose a new time; a majority of votes cast within 24h decides it. |
| **Result** | An IGC upload, scored against the task's cylinders. |
| **Rating** (beta) | Chess-style Elo. Each event is a pairwise round-robin between every pilot who flew it. |

## Scoring

Simplified, GAP-*inspired*, and deliberately **not** CIVL-compliant. Per event, normalized
against the best pilot in that field:

- **Distance** — up to 800 pts, pro-rata against the furthest pilot
- **Speed** — up to 150 pts, pro-rata against the fastest SSS→ESS time (ESS finishers only)
- **Goal** — flat 50 pt bonus

Not implemented: leading points, day quality/validity weighting, arrival points, pilot
handicaps, stopped-task rules.
