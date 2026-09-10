# NOFO Backend Test Console

A deliberately plain browser console for exercising the NOFO Flask backend that lives in
`../NOFO`. It covers every route the backend exposes, shows you the raw request and response
for each one, and keeps a running log so you can see exactly what went over the wire.

There is no build step and no dependencies — plain HTML, CSS, and ES modules.

---

## Running it

You need two things running: the backend, and a static file server for this directory.

### 1. Start the backend

```powershell
cd ..\NOFO
python app\main.py
```

It listens on port **5001**.

### 2. Serve this directory on port 3000

```powershell
cd ..\NOFO_Testing_UI
python -m http.server 3000
```

Then open **<http://localhost:3000>**.

> **Port 3000 and `localhost` both matter.** The backend only accepts cross-origin requests from
> the origins in its `CORS_ORIGINS` setting, which defaults to `http://localhost:3000`. Opening
> the page at `127.0.0.1:3000` or on any other port will make every request fail CORS, even
> though the backend is up. If you want a different port, set `CORS_ORIGINS` in `../NOFO/.env`
> to match and restart Flask.

### 3. Add your Supabase anon key

Identity is not handled by the Flask app at all — Supabase Auth issues the token and the backend
only verifies its signature. So signing in means calling Supabase directly, which needs the
project's public **anon / publishable key**.

Get it from the Supabase dashboard under **Project Settings → API Keys**, then paste it into the
**Setup** tab. It is saved in `localStorage`, so you only do this once per browser. This key is
designed to be public and safe in a browser; it is not in the backend's `.env` because the
backend never needs it.

The Supabase project URL is prefilled from the backend's `SUPABASE_URL`.

---

## Using it

Start on **Setup** to confirm the backend answers `/health`, then **Authentication** to sign in or
create an account. Once signed in, the access token is attached as `Authorization: Bearer …` on
every subsequent call, and stale tokens are refreshed automatically on a `401`.

Most routes hang off a `team_id`, so the second step is usually **Teams** → create or pick a
workspace. Clicking any id in a results table promotes it to the **active context** shown in the
sidebar, and every other panel defaults its matching field to that value — so you rarely have to
copy an id by hand.

A reasonable smoke test, in order:

1. **Setup** — check health.
2. **Authentication** — sign up or sign in, then verify the backend accepts the token.
3. **Me & profile** — save a profile (only `display_name` is required).
4. **Teams** — create a team with a category or two from **Reference data**, then load its grants.
5. **Search** — try a phrase (`tribal broadband`), a one-word keyword, an opportunity number, an assistance listing, or a Grants.gov legacy id. Click **view** on a row to open the Grant tab.
6. **Grant** — inspect the full record: summary, dates, eligibility, listings, and whether ingestion dropped any source fields. **Find similar** loads live neighbors, split into enough-time vs closing-soon.
7. **Goals** — create a goal. This streams progress over SSE and takes a few seconds.
8. **Matches** — look at what the goal matched; click `save` on a row to grab its `opportunity_id`.
9. **Saved grants** — save it to the team, then walk it through the status pipeline.
10. **Notifications** — check the inbox and the workspace activity feed.

The **Raw request** tab will send any method to any path with any JSON body, and includes an
index of every route with a one-click load into the runner.

---

## Layout

```
index.html            shell: top bar, nav, log panel
styles.css            grayscale theme
js/
  app.js              nav, hash routing, top-bar status, request log
  store.js            config, session, shared ids, log — all localStorage-backed
  api.js              backend client; one envelope for every call, plus SSE
  auth.js             Supabase Auth REST calls and JWT decoding
  dom.js              element helpers, plus the card and table components
  views/
    setup.js          connection settings, health checks
    auth.js           sign in/up/out, refresh, recovery, token inspector
    account.js        GET /api/me, POST /api/profile
    reference.js      categories, organization lookup
    teams.js          team CRUD and a team's visible grants
    members.js        roster, roles, ownership transfer, invites
    search.js         GET /api/grants/search — identifier and hybrid retrieval
    grant.js          GET /api/grants/:id — full grant record, similar neighbors, source-payload gaps
    goals.js          goal creation over SSE, goal lists, subscriptions
    matches.js        goal and team match feeds, dismissal
    saved.js          watchlists and the status pipeline
    notifications.js  inbox, unread count, team activity
    raw.js            arbitrary requests, route index
    shared.js         grant-row rendering used by several views
```

## Notes on the backend's behaviour

Things worth knowing when a response looks wrong rather than broken:

- **`GET /api/me` returns two different shapes.** A user with no profile row gets
  `{ user_id, profile: null }`; once a profile exists the fields are flattened onto the top level.
- **`POST /api/goals` is server-sent events, not JSON.** Validation failures still come back as
  ordinary JSON, so the console handles both.
- **A team with no categories sees no grants.** The response sets `needs_categories` to say so.
- **`GET /api/grants/search` is corpus-wide**, not filtered by a team's categories. Identifier
  queries can return closed grants (`is_stale`); text queries only return live ones. One-word
  text queries skip the embedding path. Grants closing in under 30 days stay in text results;
  they sort below equally targeted hits with more lead time.
- **`GET /api/grants/:id` returns the full flattened row**, plus assistance listings and `raw`.
  Closed and dormant grants are included. `visible_in_browse` is false when live search would
  hide the grant.
- **`GET /api/grants/:id/similar` is live neighbors of that grant**, split into `similar` and
  `closing_soon`. It needs a stored embedding (`409` if missing). Passing `team_id` uses that
  workspace's lead time.
- **Personal goals cannot be unfollowed** — `DELETE /api/goals/:id/subscription` answers `400`.
- **Archiving a goal is soft** (`is_active = false`), but deleting a saved grant is a hard delete.
  Use `PATCH /api/saved/:id` with `archived: true` if you want to keep the row.
- **Notifications are polled.** There is no websocket, and events are written by the nightly
  pipeline, so a fresh account's inbox stays empty until a match or a grant change happens.
- **Lists are bare JSON arrays** with no pagination envelope. Only some routes accept `limit`.
- **Errors are always `{"error": "…"}`** with no structured codes.
