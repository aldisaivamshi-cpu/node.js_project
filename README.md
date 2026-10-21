# TODO App — Node.js Edition

This project is the Node.js/Express conversion of the original Flask TODO application.

## Features
- User registration and login
- Password hashing with bcryptjs
- Session-based authentication
- User-specific task lists
- Create, view, edit, and delete TODOs
- SQLite persistence
- India-local date/time display
- Original Bootstrap-based page design retained where practical

## Requirements
- Node.js 18 or newer
- npm

## Run locally
```bash
npm install
```

Set a session secret before running (recommended even for local use):
```bash
export SESSION_SECRET="replace-with-a-long-random-secret"
npm start
```
Then open http://localhost:3000.

For development with automatic restarts:
```bash
npm run dev
```

The SQLite database is created automatically at `data/todo.sqlite` on first run.

## Main files
- `app.js` — Express server, routes, authentication, database access
- `templates/` — Nunjucks templates (compatible with much of the original Jinja template syntax)
- `data/todo.sqlite` — generated SQLite database

## Important notes
- The Flask database included in the source ZIP was empty (0 bytes), so there were no existing user/task records to migrate.
- The current project uses a development-only fallback session secret if `SESSION_SECRET` is not set. Always set a strong secret for deployment.
- The `/delete/:SNo` GET route is retained to support the original template's delete links. For production, prefer a POST form with CSRF protection.
- This is a starter conversion; run through the app locally and check every page and form before submission.
