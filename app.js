const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const sqlite3 = require("sqlite3").verbose();
const nunjucks = require("nunjucks");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const SESSION_SECRET = process.env.SESSION_SECRET;

if (!SESSION_SECRET && process.env.NODE_ENV === "production") {
  throw new Error("Set SESSION_SECRET in your production environment.");
}

const dataDir = path.join(__dirname, "data");
fs.mkdirSync(dataDir, { recursive: true });
const db = new sqlite3.Database(path.join(dataDir, "todo.sqlite"));

db.serialize(() => {
  db.run("PRAGMA foreign_keys = ON");
  db.run(`CREATE TABLE IF NOT EXISTS login (
    ID INTEGER PRIMARY KEY AUTOINCREMENT,
    FullName TEXT NOT NULL DEFAULT '',
    Email TEXT NOT NULL UNIQUE,
    Username TEXT NOT NULL UNIQUE,
    Password TEXT NOT NULL
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS todos (
    SNo INTEGER PRIMARY KEY AUTOINCREMENT,
    TODO_Title TEXT NOT NULL,
    Description TEXT NOT NULL,
    Date_Time TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES login(ID) ON DELETE CASCADE
  )`);
});

function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}
function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
  });
}
function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows));
  });
}
function indiaDateTime() {
  // Store India-local wall-clock time, matching the original Flask app.
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit",
    day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date());
  const v = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return `${v.year}-${v.month}-${v.day} ${v.hour}:${v.minute}:${v.second}`;
}
function displayDate(value, includeYear = false) {
  const date = new Date(String(value).replace(" ", "T") + (String(value).includes("Z") ? "" : "+05:30"));
  if (Number.isNaN(date.getTime())) return value;
  const opts = includeYear
    ? { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" }
    : { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" };
  return new Intl.DateTimeFormat("en-IN", opts).format(date);
}

nunjucks.configure(path.join(__dirname, "templates"), {
  autoescape: true,
  express: app,
  noCache: process.env.NODE_ENV !== "production"
});
app.set("view engine", "html");
app.use(express.urlencoded({ extended: false, limit: "20kb" }));
app.use(express.json({ limit: "20kb" }));
app.use("/public", express.static(path.join(__dirname, "public")));
app.use(session({
  name: "todo.sid",
  secret: SESSION_SECRET || "development-only-change-this-secret",
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 1000 * 60 * 60 * 8 }
}));

app.use((req, res, next) => {
  req.flash = (category, message) => {
    if (!req.session._flashes) req.session._flashes = [];
    req.session._flashes.push({ category: category === "error" ? "danger" : category, message });
  };
  res.locals.session = req.session;
  res.locals.endpoint = "";
  res.locals.messages = req.method === "GET" ? (req.session._flashes || []) : [];
  if (req.method === "GET") req.session._flashes = [];
  next();
});
function page(res, endpoint, view, data = {}) {
  res.locals.endpoint = endpoint;
  return res.render(view, data);
}
function loginRequired(req, res, next) {
  if (!req.session.user_id) {
    req.flash("info", "Please log in to access your TODOs.");
    return res.redirect("/login");
  }
  next();
}
function requireString(value) {
  return typeof value === "string" ? value.trim() : "";
}

app.get("/", (req, res) => res.redirect(req.session.user_id ? "/todos" : "/home"));
app.get("/home", (req, res) => page(res, "home", "home.html"));
app.get("/about", (req, res) => page(res, "about", "about.html"));

app.get("/register", (req, res) => {
  if (req.session.user_id) return res.redirect("/todos");
  page(res, "register", "register.html");
});
app.post("/register", async (req, res, next) => {
  try {
    if (req.session.user_id) return res.redirect("/todos");
    const fullname = requireString(req.body.fullname);
    const email = requireString(req.body.email).toLowerCase();
    const username = requireString(req.body.username);
    const password = typeof req.body.password === "string" ? req.body.password : "";
    const confirmPassword = typeof req.body.confirmPassword === "string" ? req.body.confirmPassword : "";

    if (!fullname || !email || !username || !password || !confirmPassword) {
      req.flash("error", "Please fill in all fields.");
      return res.redirect("/register");
    }
    if (username.length < 3) {
      req.flash("error", "Username must contain at least 3 characters.");
      return res.redirect("/register");
    }
    if (password.length < 8) {
      req.flash("error", "Password must contain at least 8 characters.");
      return res.redirect("/register");
    }
    if (password !== confirmPassword) {
      req.flash("error", "Passwords do not match.");
      return res.redirect("/register");
    }
    const existing = await dbGet("SELECT ID FROM login WHERE Username = ? OR Email = ?", [username, email]);
    if (existing) {
      req.flash("error", "That username or email is already registered.");
      return res.redirect("/register");
    }
    const hash = await bcrypt.hash(password, 12);
    await dbRun("INSERT INTO login (FullName, Email, Username, Password) VALUES (?, ?, ?, ?)", [fullname, email, username, hash]);
    req.flash("success", "Account created successfully! Please log in.");
    res.redirect("/login");
  } catch (err) {
    if (err && err.code === "SQLITE_CONSTRAINT") {
      req.flash("error", "That username or email is already registered.");
      return res.redirect("/register");
    }
    next(err);
  }
});

app.get("/login", (req, res) => {
  if (req.session.user_id) return res.redirect("/todos");
  page(res, "login", "login.html");
});
app.post("/login", async (req, res, next) => {
  try {
    if (req.session.user_id) return res.redirect("/todos");
    const username = requireString(req.body.Username || req.body.username);
    const password = typeof (req.body.Password || req.body.password) === "string" ? (req.body.Password || req.body.password) : "";
    const user = await dbGet("SELECT * FROM login WHERE Username = ?", [username]);
    if (!user || !(await bcrypt.compare(password, user.Password))) {
      req.flash("error", "Invalid username or password.");
      return res.redirect("/login");
    }
    req.session.regenerate(err => {
      if (err) return next(err);
      req.session.user_id = user.ID;
      req.session.username = user.Username;
      req.session.full_name = user.FullName;
      req.flash("success", `Welcome back, ${user.FullName || user.Username}!`);
      res.redirect("/todos");
    });
  } catch (err) { next(err); }
});
app.get("/logout", (req, res, next) => {
  req.session.destroy(err => {
    if (err) return next(err);
    res.clearCookie("todo.sid");
    res.redirect("/home");
  });
});

app.get("/todos", loginRequired, async (req, res, next) => {
  try {
    const rows = await dbAll("SELECT * FROM todos WHERE user_id = ? ORDER BY SNo ASC", [req.session.user_id]);
    const allTODO = rows.map(todo => ({ ...todo, displayDate: displayDate(todo.Date_Time) }));
    page(res, "todos", "index.html", { allTODO });
  } catch (err) { next(err); }
});
app.post("/todos", loginRequired, async (req, res, next) => {
  try {
    const title = requireString(req.body.todoTitle);
    const description = requireString(req.body.todoDescription);
    if (!title || !description) {
      req.flash("error", "Title and description are required.");
      return res.redirect("/todos");
    }
    await dbRun("INSERT INTO todos (TODO_Title, Description, Date_Time, user_id) VALUES (?, ?, ?, ?)",
      [title, description, indiaDateTime(), req.session.user_id]);
    req.flash("success", "Task added successfully!");
    res.redirect("/todos");
  } catch (err) { next(err); }
});
app.get("/update/:SNo", loginRequired, async (req, res, next) => {
  try {
    const todo = await dbGet("SELECT * FROM todos WHERE SNo = ? AND user_id = ?", [Number(req.params.SNo), req.session.user_id]);
    if (!todo) {
      req.flash("error", "Task not found.");
      return res.redirect("/todos");
    }
    todo.displayDate = displayDate(todo.Date_Time, true);
    page(res, "update", "update.html", { edit_todo: todo });
  } catch (err) { next(err); }
});
app.post("/update/:SNo", loginRequired, async (req, res, next) => {
  try {
    const title = requireString(req.body.todoTitle);
    const description = requireString(req.body.todoDescription);
    if (!title || !description) {
      req.flash("error", "Title and description are required.");
      return res.redirect(`/update/${Number(req.params.SNo)}`);
    }
    const result = await dbRun(
      "UPDATE todos SET TODO_Title = ?, Description = ?, Date_Time = ? WHERE SNo = ? AND user_id = ?",
      [title, description, indiaDateTime(), Number(req.params.SNo), req.session.user_id]
    );
    if (!result.changes) req.flash("error", "Task not found.");
    else req.flash("success", "Task updated successfully!");
    res.redirect("/todos");
  } catch (err) { next(err); }
});
app.get("/delete/:SNo", loginRequired, async (req, res, next) => {
  try {
    const result = await dbRun("DELETE FROM todos WHERE SNo = ? AND user_id = ?", [Number(req.params.SNo), req.session.user_id]);
    if (result.changes) req.flash("success", "Task deleted.");
    else req.flash("error", "Task not found.");
    res.redirect("/todos");
  } catch (err) { next(err); }
});

app.post("/delete/:SNo", loginRequired, async (req, res, next) => {
  try {
    const result = await dbRun("DELETE FROM todos WHERE SNo = ? AND user_id = ?", [Number(req.params.SNo), req.session.user_id]);
    if (result.changes) req.flash("success", "Task deleted.");
    else req.flash("error", "Task not found.");
    res.redirect("/todos");
  } catch (err) { next(err); }
});

app.use((req, res) => res.status(404).send("Page not found."));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).send(process.env.NODE_ENV === "production"
    ? "Something went wrong. Please try again."
    : `Server error: ${err.message}`);
});

app.listen(PORT, () => console.log(`TODO Node.js app running at http://localhost:${PORT}`));
