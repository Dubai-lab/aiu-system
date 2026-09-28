# AIU Voice Assistance and Face ID Management System

Final year project: a university management web app built around **face ID login**,
**face-verified class attendance** and an **AI voice assistant** that can operate the
whole system for Admins, Teachers and Students.

| App | Stack | Port |
|---|---|---|
| `frontend/` | React 18, Vite, TypeScript, Tailwind CSS, TanStack Query, supabase-js | 5173 |
| `backend/` | Python, FastAPI, Pydantic v2, supabase-py, Anthropic SDK | 8000 |
| `face-service/` | Python 3.12, FastAPI, InsightFace 2.0 `buffalo_l` on ONNX Runtime | 8001 (localhost only) |
| Database | Supabase (Postgres + pgvector, Auth, Realtime) | - |

```
aiu_system/
├── shared/pages.json        page registry shared by the router and the assistant
├── supabase/migrations/     numbered SQL files (schema, RLS, functions)
├── supabase/seed.sql        demo departments, courses, fee types
├── scripts/create_admin.py  creates the first admin account
├── scripts/seed_demo.py     adds / removes demo data for a presentation
├── frontend/  backend/  face-service/
```

---

## 1. Prerequisites

- **Node.js 20+**
- **64-bit Python 3.12** for the backend and the face service (tested). InsightFace 2.0 ships a
  ready-made package, so **no C++ Build Tools are needed**. A **32-bit** Python will not work,
  because ONNX Runtime has no 32-bit build. Check with `py -0p` and always create the venvs with `py -3.12`.
- A Supabase project.

## 2. Database setup (Supabase SQL Editor)

Open **Supabase Dashboard → SQL Editor** and run each file **in order**, one at a time.
Paste the whole file and click **Run**:

1. `supabase/migrations/0001_foundation.sql`
2. `supabase/migrations/0002_people_and_academics.sql`
3. `supabase/migrations/0003_face.sql`
4. `supabase/migrations/0004_attendance.sql`
5. `supabase/migrations/0005_finance.sql`
6. `supabase/migrations/0006_assistant_audit_email.sql`
7. `supabase/migrations/0007_rls_guard.sql`: should print *"RLS guard passed"*
8. `supabase/migrations/0008_payments.sql` (atomic simulated payment)
9. `supabase/seed.sql`

Also, under **Authentication → Sign In / Providers**, turn **off** *Allow new users to sign up*.
Only the admin creates accounts.

### Security model (for the defence)

- **RLS is enabled on every table** in the same migration that creates it.
  `0007_rls_guard.sql` refuses to pass if any public table has RLS off.
- **The browser never writes to the database.** All writes go through the backend
  with the service role key, so there are no INSERT/UPDATE/DELETE policies at all.
  Anyone holding the public anon key cannot change data.
- The browser can **read** only three tables, for Realtime:
  - `profiles`: own row only
  - `attendance_sessions`: sessions the user teaches, or of courses the student is enrolled in
  - `attendance_records`: the student's own records, or records of the teacher's own sessions
- Everything else is backend-only: RLS on, no policies, and table privileges revoked
  from `anon` and `authenticated`, which gives two independent locks.
- The class code lives in `attendance_session_codes` (backend-only), **not** in
  `attendance_sessions`. Otherwise the Realtime feed would reveal the code to students
  who are not in the room.
- Policy helpers (`private.is_enrolled`, `private.owns_session`, `private.is_active_user`)
  are `security definer` with an empty `search_path`, live in a schema that is not
  exposed through the API, and avoid recursive RLS on `profiles`.
- `match_faces`, `verify_face` and the number generators can be executed **only** by
  the service role.
- No face images are stored. Only one averaged 512-number embedding per user.

## 3. Environment variables

Each app has a `.env.example`. Copy it to `.env` and fill it in. Real `.env` files are git-ignored.

| Value | Where to get it |
|---|---|
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | Supabase → Project Settings → API Keys (anon / publishable) |
| `SUPABASE_SERVICE_ROLE_KEY` | Same page (service_role / secret). **Backend only**, never in the frontend |
| `ANTHROPIC_API_KEY` | console.anthropic.com → API Keys |
| `SMTP_PASSWORD` | Google Account → Security → 2-Step Verification → **App passwords** |
| `FACE_SERVICE_KEY` | Any long random string; must be identical in `backend/.env` and `face-service/.env` |

Set `EMAIL_MODE=console` to print emails in the backend terminal instead of sending them.

## 4. Running the apps (three terminals)

**Backend**
```powershell
cd backend
py -3.12 -m venv .venv
.venv\Scripts\pip install -r requirements.txt
.venv\Scripts\uvicorn app.main:app --reload --port 8000
```
Check http://127.0.0.1:8000/health, which should show `"database": "ok"`. API docs are at http://127.0.0.1:8000/docs.

**Face service**
```powershell
cd face-service
py -3.12 -m venv .venv
.venv\Scripts\pip install -r requirements.txt
.venv\Scripts\uvicorn main:app --host 127.0.0.1 --port 8001
```
On first start InsightFace downloads `buffalo_l` (~300 MB) to `~/.insightface/models/`.

**Frontend**
```powershell
cd frontend
npm install
npm run dev
```
Open http://localhost:5173.

## 5. Email (credentials, password resets)

| `EMAIL_MODE` | What happens |
|---|---|
| `console` (default) | Emails are printed in the backend terminal. Nothing is sent. Use this for development and demos without internet. |
| `smtp` | Emails are sent over SMTP. |

To send real email with Gmail:
1. Turn on **2-Step Verification** for the Gmail account.
2. Go to Google Account → Security → **App passwords** and create one (for example "AIU System").
3. In `backend/.env`, set `EMAIL_MODE=smtp`, `SMTP_USER` and `EMAIL_FROM_ADDRESS` to the Gmail address,
   and `SMTP_PASSWORD` to the 16-character app password.
4. Restart the backend.

Every attempt is recorded in the `email_logs` table. If a credentials email fails, the user is still
created, and their page shows **"Credentials email failed - Resend"**.
Passwords are never stored or logged. *Resend* and *Reset password* always generate a new default password.

## 6. First admin account

```powershell
backend\.venv\Scripts\python scripts\create_admin.py --email admin@aiu.edu --name "System Administrator" --title "Dean"
```
The password is printed **once**. Log in and change it from the Profile page.

## 7. Using the system

| Role | Logs in with | Main things they do |
|---|---|---|
| **Admin** | email + password, or Face ID | register students / teachers / admins, enroll faces, departments, courses, enrollments, fees, invoices, attendance report, audit log, email log |
| **Teacher** | email + password, or Face ID | start a timed attendance session with a class code, watch students check in live, mark manually with a reason, reports + CSV |
| **Student** | **registration number** + password, or Face ID | mark attendance (class code + face + liveness), see attendance %, create invoices and pay them (simulated), receipts |

- **New accounts** get a random default password by email and must change it after the first login.
- **Face ID login**: the user looks at the camera, then turns their head in the direction shown
  (a liveness check against photos). Faces are enrolled by an admin from the user's page.
- **Attendance**: only one session can be open per course. A session closes automatically when its time runs out.
  A student enrolled late is never counted absent for sessions held before they enrolled.
  Anything below `ATTENDANCE_LOW_THRESHOLD` (default 75%) is shown in red.
- **Payments are simulated.** No real money is charged and card numbers are never stored.
  Card `4242 4242 4242 4242` succeeds and `4000 0000 0000 0002` is declined, both with any future expiry and any CVC.
- **Dashboards** are role-specific. The admin dashboard links to the **Audit log**, which shows every change and
  login and whether it was done **by voice or by clicking**, and to the **Email log**, where failed login-detail
  emails can be resent.

## 8. The voice assistant

Click the microphone button (bottom right) on any page. Speak or type. The assistant can do everything
the logged-in user could do by clicking, and nothing more: every tool call goes through the same service
function as the matching button, with the same role checks.

Examples:
- Admin: *"Register a student named Mary Kollie in Computer Science, level 200"*, *"Who has not enrolled their face?"*, *"Open the audit log"*
- Teacher: *"Start attendance for CSC301 for 10 minutes"*, *"Extend it by 5 minutes"*, *"Who is absent?"*
- Student: *"What is my attendance in Database Systems?"*, *"Create an invoice for the registration fee and pay it"*

Anything that changes data (registering, paying, closing a session and so on) is **confirmed first**:
say "yes" or click **Confirm**. Voice input and spoken replies use the browser's Web Speech API, so use
**Chrome or Edge** and allow the microphone. The speaker button turns spoken replies on or off.
Actions taken through the assistant appear in the audit log as **Voice**.

## 9. Demo data

For a presentation, fill the system with realistic sample data:

```powershell
backend\.venv\Scripts\python scripts\seed_demo.py            # add
backend\.venv\Scripts\python scripts\seed_demo.py --remove   # remove again
```

This adds 2 teachers, 8 students, 3 courses, two weeks of attendance history (one student below the
threshold on purpose) and invoices, half of them paid. All demo accounts use `@demo.example.org`, a reserved
test domain, so **no email is ever sent** to them. They share one password, which is written to
`scripts/demo_credentials.txt` (git-ignored). `--remove` deletes only the demo accounts and the demo courses.
It never touches real users.

## 10. Tests

```powershell
cd backend;  .venv\Scripts\python -m pytest -q     # service rules, assistant registry, security helpers
cd frontend; npm test                              # page registry, speech text, helpers
cd frontend; npm run build                         # type check + production build
```

## 11. Troubleshooting

| Symptom | Fix |
|---|---|
| The app talks to the **wrong Supabase project** | Windows environment variables `VITE_SUPABASE_*` override `.env`. Check with `Get-ChildItem Env:VITE*` and remove them. |
| Every request takes ~2 s | Use `127.0.0.1` instead of `localhost` in `VITE_API_BASE_URL` (on Windows, `localhost` tries IPv6 first). |
| `pip install` of the face service fails | You are on 32-bit Python or not on 3.12. Recreate the venv with `py -3.12`. |
| "Face service unavailable" | Start the face service (port 8001), and make sure `FACE_SERVICE_KEY` is identical in both `.env` files. |
| Camera does not start | Allow camera access for `localhost` in the browser, and close other apps using the webcam. |
| Face ID login says the turn was in the wrong direction | Your webcam mirrors the image. Flip `FACE_YAW_LEFT_SIGN` (`1` ↔ `-1`) in `backend/.env`. |
| Backend code changes seem ignored | An old `uvicorn --reload` worker is still running. Stop all Python processes on port 8000 and start again. |
| Emails are not arriving | Check the **Email log** page for the error. Gmail needs an *App password*, not the normal password. Addresses at `example.com/org/net` and `.test` domains are never sent, by design. |

## 12. Licences

- The InsightFace `buffalo_l` models are released for **non-commercial research use only**,
  which covers this academic project. Any commercial use would need a separately licensed model.
- Other libraries (React, FastAPI, Supabase clients, Tailwind, lucide icons, TanStack Query, Anthropic SDK)
  are MIT / Apache-2.0 / ISC licensed.
