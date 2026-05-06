# MonashVote

## Folder structure

```
monash-voting/
├── frontend/          ← All your HTML files go here
│   ├── index.html
│   ├── login.html
│   ├── verification.html
│   ├── traits.html
│   ├── dashboard.html
│   ├── dashboard-admin.html
│   ├── vote.html
│   └── results.html
│
└── backend/           ← Node.js server
    ├── server.js      ← Entry point (serves frontend + API)
    ├── db.js
    ├── utils.js
    ├── .env           ← Config (copy from .env.example)
    ├── routes/
    │   ├── auth.js
    │   ├── elections.js
    │   ├── traits.js
    │   └── admin.js
    └── middleware/
        └── auth.js
```

## Setup & run

```bash
cd backend
npm install
node server.js
```

Then open **http://localhost:3000** in your browser.

> **Important:** Always open the app via http://localhost:3000, NOT by double-clicking the HTML files.
> Opening HTML files directly (file://) breaks API calls.

## Dev mode test flow

1. Go to http://localhost:3000/login.html
2. Register with any `@student.monash.edu` email  
3. Log in — the verification code prints in the terminal (no real email needed)
4. Enter the code on the verification page
5. Fill in traits → lands on dashboard with real elections loaded
6. Click an election → vote → ballot submitted to backend
7. Admin dashboard: log in as `admin@monash.edu` to see stats & activity

## For your friend (SQL integration)

Every route has a `// TODO (your friend):` comment with the exact SQL needed.
They just replace the `if (!isDev) { return res.status(501)... }` block with their PostgreSQL query.
