"use strict";

/* ==========================================
   DOWNLOADGAMES – BACKEND
   Echte Konten (SQLite), Sessions per Cookie, E-Mail-Bestätigung,
   Passwort-Reset per E-Mail-Link, Punkte, Käufe, Kommentare, Schlüssel, Admin.
   Wird in server.js eingebunden:  const backend = require("./backend")(app, { root: __dirname });

   Umgebungsvariablen (alle optional, aber für den Live-Betrieb nötig):
     BASE_URL     öffentliche Adresse der Seite, z. B. https://meine-seite.de
     ADMIN_EMAIL  dieses Konto (nach E-Mail-Bestätigung) wird automatisch Admin
     SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM   für den E-Mail-Versand
     TRUST_PROXY  "1", wenn die Seite hinter einem Proxy (Render, nginx ...) läuft
========================================== */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const vm = require("vm");
const express = require("express");
const Database = require("better-sqlite3");

let nodemailer = null;
try { nodemailer = require("nodemailer"); } catch { /* ohne nodemailer: Mails nur in der Konsole */ }

const BASE_URL = (process.env.BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
const SECURE_COOKIE = BASE_URL.startsWith("https://");
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "azizdjebbitn@gmail.com").trim().toLowerCase();

const SESSION_DAYS = 30;
const POINTS_PER_TICK = 100;     // Demo-Punkte: 100 alle 10 Sekunden ...
const TICK_MS = 10000;
const MAX_TICKS = 6;             // ... aber höchstens 6 Ticks nachholen (verhindert Farmen ohne geöffnete Seite)

const USERNAME_RE = /^[A-Za-z0-9_.-]{3,24}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

class HttpError extends Error {
    constructor(status, message, extra) {
        super(message);
        this.status = status;
        this.extra = extra;
    }
}

const fail = (res, status, error, extra) => res.status(status).json({ error, ...extra });
const clean = (v, max) => String(v ?? "").trim().slice(0, max);
const sha = s => crypto.createHash("sha256").update(String(s)).digest("hex");
const newToken = () => crypto.randomBytes(32).toString("base64url");
const ah = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const isHttpUrl = v => {
    try {
        const u = new URL(v);
        return u.protocol === "http:" || u.protocol === "https:";
    } catch {
        return false;
    }
};

function parseCookies(header) {
    const out = {};
    String(header || "").split(";").forEach(part => {
        const i = part.indexOf("=");
        if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    });
    return out;
}

function randomKey() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const bytes = crypto.randomBytes(20);
    return Array.from(bytes, b => chars[b % chars.length]).join("").match(/.{5}/g).join("-");
}

module.exports = function mountBackend(app, { root }) {

    if (process.env.TRUST_PROXY) app.set("trust proxy", 1);

    /* ---------- Datenbank ---------- */

    const DATA_DIR = path.join(root, "data");
    fs.mkdirSync(DATA_DIR, { recursive: true });

    const db = new Database(path.join(DATA_DIR, "downloadgames.sqlite"));
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");

    db.exec(`
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  salt TEXT NOT NULL,
  hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  verified INTEGER NOT NULL DEFAULT 0,
  points INTEGER NOT NULL DEFAULT 0,
  points_ts INTEGER NOT NULL,
  created INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions(
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tokens(
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  data TEXT,
  expires INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS games(
  id TEXT PRIMARY KEY,
  pos INTEGER NOT NULL,
  json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS purchases(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id TEXT NOT NULL,
  name TEXT NOT NULL,
  cost INTEGER NOT NULL,
  type TEXT NOT NULL,
  date INTEGER NOT NULL,
  UNIQUE(user_id, game_id)
);
CREATE TABLE IF NOT EXISTS comments(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  stars INTEGER NOT NULL DEFAULT 0,
  date INTEGER NOT NULL,
  UNIQUE(game_id, user_id)
);
CREATE TABLE IF NOT EXISTS keys(
  key TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  used INTEGER NOT NULL DEFAULT 0,
  used_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created INTEGER NOT NULL
);`);

    function cleanup() {
        const now = Date.now();
        db.prepare("DELETE FROM sessions WHERE expires < ?").run(now);
        db.prepare("DELETE FROM tokens WHERE expires < ?").run(now);
    }
    cleanup();
    setInterval(cleanup, 3600 * 1000).unref();

    /* ---------- Spielkatalog (liegt in der Datenbank; games.js dient nur als Startdaten) ---------- */

    function readSeedGames() {
        const file = path.join(root, "games.js");
        if (!fs.existsSync(file)) return [];

        const src = fs.readFileSync(file, "utf8");
        const list = vm.runInNewContext(src + "\n;games", {}, { timeout: 2000 });

        const seen = new Set();
        return JSON.parse(JSON.stringify(list)).filter(g => g && g.id && !seen.has(g.id) && seen.add(g.id));
    }

    function seedGames(force) {
        const count = db.prepare("SELECT COUNT(*) c FROM games").get().c;
        if (count && !force) return;

        const list = readSeedGames();
        const tx = db.transaction(() => {
            db.prepare("DELETE FROM games").run();
            list.forEach((g, i) => db.prepare("INSERT INTO games (id, pos, json) VALUES (?,?,?)").run(g.id, i, JSON.stringify(g)));
        });
        tx();
    }
    seedGames(false);

    const allGames = () => db.prepare("SELECT json FROM games ORDER BY pos").all().map(r => JSON.parse(r.json));
    const getGame = id => {
        const r = db.prepare("SELECT json FROM games WHERE id = ?").get(String(id));
        return r ? JSON.parse(r.json) : null;
    };

    // Öffentliche Sicht: nie die Download-URL ausliefern, dazu Bewertung, Beliebtheit, Lagerbestand
    function publicGames() {
        const ratings = new Map(db.prepare("SELECT game_id, AVG(stars) a, COUNT(*) c FROM comments WHERE stars > 0 GROUP BY game_id").all()
            .map(r => [r.game_id, r]));
        const comments = new Map(db.prepare("SELECT game_id, COUNT(*) c FROM comments GROUP BY game_id").all().map(r => [r.game_id, r.c]));
        const bought = new Map(db.prepare("SELECT game_id, COUNT(*) c FROM purchases GROUP BY game_id").all().map(r => [r.game_id, r.c]));
        const stock = new Map(db.prepare("SELECT game_id, COUNT(*) c FROM keys WHERE active = 1 AND used = 0 GROUP BY game_id").all().map(r => [r.game_id, r.c]));

        return allGames().map(g => {
            const { downloadUrl, ...rest } = g;
            const r = ratings.get(g.id);

            return {
                ...rest,
                hasDownload: g.free === true && !!downloadUrl,
                ratingAvg: r ? Number(r.a) : 0,
                ratingCount: r ? r.c : 0,
                popularity: (bought.get(g.id) || 0) + (comments.get(g.id) || 0),
                stock: stock.get(g.id) || 0
            };
        });
    }

    function parseGameInput(b, existing) {
        const name = clean(b.name, 120);
        if (!name) throw new HttpError(400, "Name fehlt.");

        const price = Number(String(b.price ?? "").replace(",", "."));
        const points = Number(b.points);

        if (!Number.isFinite(price) || price < 0 || !Number.isInteger(points) || points < 0) {
            throw new HttpError(400, "Preis und Punktepreis müssen gültige Zahlen sein.");
        }

        const url = k => {
            const v = clean(b[k], 600);
            if (v && !isHttpUrl(v)) throw new HttpError(400, `Ungültige URL im Feld „${k}“.`);
            return v;
        };

        const reqs = r => {
            if (!r || typeof r !== "object") return undefined;
            const f = k => clean(r[k], 120) || "–";
            return { os: f("os"), cpu: f("cpu"), ram: f("ram"), gpu: f("gpu"), storage: f("storage") };
        };

        const screenshots = (Array.isArray(b.screenshots) ? b.screenshots : [])
            .map(s => clean(s, 600)).filter(Boolean).slice(0, 12);

        if (screenshots.some(s => !isHttpUrl(s))) throw new HttpError(400, "Ungültige Screenshot-URL.");

        const game = {
            id: existing ? existing.id : null,
            name,
            genre: clean(b.genre, 60),
            year: Number(b.year) || new Date().getFullYear(),
            releaseDate: clean(b.releaseDate, 20),
            price,
            points,
            developer: clean(b.developer, 80),
            version: clean(b.version, 40),
            size: clean(b.size, 40),
            icon: clean(b.icon, 8) || "🎮",
            image: url("image"),
            screenshots,
            storeUrl: url("storeUrl"),
            downloadUrl: url("downloadUrl"),
            free: b.free === true,
            description: clean(b.description, 5000)
        };

        const min = reqs(b.requirements && b.requirements.minimum);
        const rec = reqs(b.requirements && b.requirements.recommended);
        if (min || rec) game.requirements = { minimum: min, recommended: rec };

        if (!game.id) {
            const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "spiel";
            game.id = `${slug}-${crypto.randomBytes(2).toString("hex")}`;
        }

        return game;
    }

    /* ---------- Passwörter (scrypt mit Salt) ---------- */

    const scrypt = (pw, salt) => new Promise((resolve, reject) =>
        crypto.scrypt(pw, salt, 64, (e, k) => (e ? reject(e) : resolve(k.toString("hex")))));

    async function hashPassword(pw) {
        const salt = crypto.randomBytes(16).toString("hex");
        return { salt, hash: await scrypt(pw, salt) };
    }

    async function checkPassword(u, pw) {
        const h = await scrypt(pw, u.salt);
        return crypto.timingSafeEqual(Buffer.from(h, "hex"), Buffer.from(u.hash, "hex"));
    }

    const DUMMY_USER = { salt: "0".repeat(32), hash: "0".repeat(128) };

    function checkNewPassword(pw) {
        if (typeof pw !== "string" || pw.length < 8) throw new HttpError(400, "Passwort: mind. 8 Zeichen.");
        if (pw.length > 200) throw new HttpError(400, "Passwort: höchstens 200 Zeichen.");
    }

    /* ---------- E-Mail ---------- */

    let transporter = null;

    if (nodemailer && process.env.SMTP_HOST) {
        const port = Number(process.env.SMTP_PORT) || 587;
        transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port,
            secure: port === 465,
            auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined
        });
    }

    async function sendMail(to, subject, text) {
        if (!transporter) {
            console.log("\n[MAIL – SMTP nicht eingerichtet, Ausgabe nur hier in der Konsole]");
            console.log("An: " + to + "\nBetreff: " + subject + "\n" + text + "\n");
            return;
        }

        await transporter.sendMail({
            from: process.env.MAIL_FROM || process.env.SMTP_USER,
            to,
            subject,
            text
        });
    }

    /* ---------- Tokens (Bestätigung, Reset, E-Mail-Änderung) ---------- */

    function createToken(userId, type, ttlMs, data = null) {
        db.prepare("DELETE FROM tokens WHERE user_id = ? AND type = ?").run(userId, type);

        const token = newToken();
        db.prepare("INSERT INTO tokens (token_hash, user_id, type, data, expires) VALUES (?,?,?,?,?)")
            .run(sha(token), userId, type, data, Date.now() + ttlMs);

        return token;
    }

    function consumeToken(token, type) {
        const row = db.prepare("SELECT * FROM tokens WHERE token_hash = ? AND type = ?").get(sha(token || ""), type);
        if (!row) return null;

        db.prepare("DELETE FROM tokens WHERE token_hash = ?").run(row.token_hash);
        return row.expires < Date.now() ? null : row;
    }

    async function mailVerify(userId, email, username) {
        const token = createToken(userId, "verify", 24 * 3600 * 1000);
        await sendMail(email, "DownloadGames – bitte E-Mail bestätigen",
            `Hallo ${username},\n\nbestätige deine E-Mail-Adresse mit diesem Link (24 Stunden gültig):\n${BASE_URL}/?verify=${token}\n\nWenn du dich nicht registriert hast, ignoriere diese Mail.`);
    }

    function promoteIfAdmin(userId) {
        db.prepare("UPDATE users SET role = 'admin' WHERE id = ? AND verified = 1 AND lower(email) = ?").run(userId, ADMIN_EMAIL);
    }

    /* ---------- Punkte (serverseitig, nicht manipulierbar) ---------- */

    function accrue(u) {
        const now = Date.now();
        const ticks = Math.min(Math.floor((now - u.points_ts) / TICK_MS), MAX_TICKS);

        if (ticks > 0) {
            const ts = ticks === MAX_TICKS ? now : u.points_ts + ticks * TICK_MS;
            db.prepare("UPDATE users SET points = points + ?, points_ts = ? WHERE id = ?").run(ticks * POINTS_PER_TICK, ts, u.id);
            u.points += ticks * POINTS_PER_TICK;
            u.points_ts = ts;
        }

        return u;
    }

    function userPayload(u) {
        const purchases = db.prepare("SELECT game_id, name, cost, type, date FROM purchases WHERE user_id = ? ORDER BY date").all(u.id);

        return {
            username: u.username,
            email: u.email,
            role: u.role,
            points: u.points,
            purchasedGames: purchases.map(p => p.game_id),
            history: purchases.map(p => ({
                date: new Date(p.date).toISOString(),
                gameId: p.game_id,
                name: p.name,
                cost: p.cost,
                type: p.type
            }))
        };
    }

    /* ---------- Sessions ---------- */

    function userFromReq(req) {
        const sid = parseCookies(req.headers.cookie).dg_sid;
        if (!sid) return null;

        const row = db.prepare("SELECT u.*, s.expires AS s_expires FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?").get(sha(sid));
        if (!row || row.s_expires < Date.now()) return null;

        return accrue(row);
    }

    function startSession(res, userId) {
        const token = newToken();
        db.prepare("INSERT INTO sessions (token_hash, user_id, expires) VALUES (?,?,?)")
            .run(sha(token), userId, Date.now() + SESSION_DAYS * 864e5);

        res.cookie("dg_sid", token, {
            httpOnly: true,
            sameSite: "lax",
            secure: SECURE_COOKIE,
            maxAge: SESSION_DAYS * 864e5,
            path: "/"
        });
    }

    /* ---------- Schutzmaßnahmen: Header, Origin-Prüfung, Rate-Limit ---------- */

    app.use((req, res, next) => {
        res.set({
            "X-Content-Type-Options": "nosniff",
            "X-Frame-Options": "DENY",
            "Referrer-Policy": "strict-origin-when-cross-origin"
        });
        next();
    });

    const hits = new Map();
    setInterval(() => {
        const now = Date.now();
        for (const [k, v] of hits) if (!v.length || now - v[v.length - 1] > 3600 * 1000) hits.delete(k);
    }, 600 * 1000).unref();

    const limit = (name, max, windowMs, keyFn = req => req.ip) => (req, res, next) => {
        const key = name + ":" + keyFn(req);
        const now = Date.now();
        const list = (hits.get(key) || []).filter(t => now - t < windowMs);

        if (list.length >= max) return fail(res, 429, "Zu viele Versuche. Bitte warte etwas und versuche es dann erneut.");

        list.push(now);
        hits.set(key, list);
        next();
    };

    /* ---------- API ---------- */

    const api = express.Router();

    // Schreibende Anfragen nur von der eigenen Seite (zusätzlich zu SameSite-Cookies)
    api.use((req, res, next) => {
        if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();

        const origin = req.get("origin");
        if (origin) {
            try {
                if (new URL(origin).host !== req.get("host")) return fail(res, 403, "Anfrage von fremder Seite abgelehnt.");
            } catch {
                return fail(res, 403, "Ungültiger Origin.");
            }
        }

        next();
    });

    api.use((req, res, next) => {
        req.user = userFromReq(req);
        res.set("Cache-Control", "no-store");
        next();
    });

    const needUser = (req, res, next) => (req.user ? next() : fail(res, 401, "Bitte zuerst anmelden."));
    const needAdmin = (req, res, next) =>
        !req.user ? fail(res, 401, "Bitte zuerst anmelden.")
            : req.user.role !== "admin" ? fail(res, 403, "Nur für Admins.")
                : next();

    const body = req => (req.body && typeof req.body === "object" ? req.body : {});

    /* ----- Konto: Registrierung, Bestätigung, Login ----- */

    api.post("/register", limit("register", 10, 3600 * 1000), ah(async (req, res) => {
        const b = body(req);
        const username = clean(b.username, 24);
        const email = clean(b.email, 120).toLowerCase();
        const password = b.password;

        if (!USERNAME_RE.test(username)) throw new HttpError(400, "Benutzername: 3 bis 24 Zeichen (Buchstaben, Zahlen, _ . -).");
        if (!EMAIL_RE.test(email)) throw new HttpError(400, "Bitte eine gültige E-Mail angeben.");
        checkNewPassword(password);

        if (db.prepare("SELECT 1 FROM users WHERE username = ? OR email = ?").get(username, email)) {
            throw new HttpError(409, "Benutzername oder E-Mail ist bereits vergeben.");
        }

        const { salt, hash } = await hashPassword(password);
        let id;

        try {
            id = db.prepare("INSERT INTO users (username, email, salt, hash, points_ts, created) VALUES (?,?,?,?,?,?)")
                .run(username, email, salt, hash, Date.now(), Date.now()).lastInsertRowid;
        } catch {
            throw new HttpError(409, "Benutzername oder E-Mail ist bereits vergeben.");
        }

        try {
            await mailVerify(id, email, username);
        } catch (error) {
            console.error("Bestätigungs-Mail fehlgeschlagen:", error.message);
            db.prepare("DELETE FROM users WHERE id = ?").run(id);
            throw new HttpError(502, "Die Bestätigungs-E-Mail konnte nicht gesendet werden. Bitte später erneut versuchen.");
        }

        res.json({ ok: true, message: "Fast geschafft! Wir haben dir eine E-Mail zur Bestätigung geschickt." });
    }));

    api.post("/verify", limit("verify", 30, 3600 * 1000), ah(async (req, res) => {
        const row = consumeToken(body(req).token, "verify");
        if (!row) throw new HttpError(400, "Der Link ist ungültig oder abgelaufen.");

        db.prepare("UPDATE users SET verified = 1 WHERE id = ?").run(row.user_id);
        promoteIfAdmin(row.user_id);

        res.json({ ok: true });
    }));

    api.post("/resend-verification", limit("resend", 5, 3600 * 1000), ah(async (req, res) => {
        const id = clean(body(req).identifier, 120);
        const u = id ? db.prepare("SELECT * FROM users WHERE username = ? OR email = ?").get(id, id) : null;

        if (u && !u.verified) {
            try { await mailVerify(u.id, u.email, u.username); } catch (e) { console.error("Mail:", e.message); }
        }

        res.json({ ok: true, message: "Falls das Konto existiert und noch nicht bestätigt ist, wurde eine neue E-Mail gesendet." });
    }));

    api.post("/login",
        limit("login-ip", 30, 15 * 60 * 1000),
        limit("login-id", 8, 15 * 60 * 1000, req => clean(body(req).identifier, 120).toLowerCase()),
        ah(async (req, res) => {
            const b = body(req);
            const id = clean(b.identifier, 120);
            const password = typeof b.password === "string" ? b.password.slice(0, 200) : "";

            const u = id ? db.prepare("SELECT * FROM users WHERE username = ? OR email = ?").get(id, id) : null;
            const ok = await checkPassword(u || DUMMY_USER, password);   // immer rechnen: gleiche Antwortzeit

            if (!u || !ok) throw new HttpError(401, "Benutzername/E-Mail oder Passwort ist falsch.");

            if (!u.verified) {
                throw new HttpError(403, "Bitte bestätige zuerst deine E-Mail-Adresse (Link in der Mail).", { code: "unverified" });
            }

            promoteIfAdmin(u.id);
            startSession(res, u.id);

            const fresh = accrue(db.prepare("SELECT * FROM users WHERE id = ?").get(u.id));
            res.json({ user: userPayload(fresh) });
        }));

    api.post("/logout", (req, res) => {
        const sid = parseCookies(req.headers.cookie).dg_sid;
        if (sid) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha(sid));
        res.clearCookie("dg_sid", { path: "/" });
        res.json({ ok: true });
    });

    api.get("/me", (req, res) => res.json({ user: req.user ? userPayload(req.user) : null }));

    api.post("/ping", needUser, (req, res) => res.json({ points: req.user.points }));

    /* ----- Passwort vergessen / zurücksetzen ----- */

    api.post("/forgot", limit("forgot", 5, 15 * 60 * 1000), ah(async (req, res) => {
        const id = clean(body(req).identifier, 120);
        const u = id ? db.prepare("SELECT * FROM users WHERE username = ? OR email = ?").get(id, id) : null;

        if (u) {
            try {
                const token = createToken(u.id, "reset", 3600 * 1000);
                await sendMail(u.email, "DownloadGames – Passwort zurücksetzen",
                    `Hallo ${u.username},\n\nmit diesem Link legst du ein neues Passwort fest (1 Stunde gültig, nur einmal nutzbar):\n${BASE_URL}/?reset=${token}\n\nWenn du das nicht angefordert hast, ignoriere diese Mail. Dein Passwort bleibt dann unverändert.`);
            } catch (error) {
                console.error("Reset-Mail fehlgeschlagen:", error.message);
            }
        }

        // Immer dieselbe Antwort: so kann niemand herausfinden, welche Konten existieren
        res.json({ ok: true, message: "Falls ein Konto dazu existiert, haben wir einen Link zum Zurücksetzen an die hinterlegte E-Mail-Adresse gesendet." });
    }));

    api.post("/reset", limit("reset", 10, 15 * 60 * 1000), ah(async (req, res) => {
        const b = body(req);
        checkNewPassword(b.password);

        const row = consumeToken(b.token, "reset");
        if (!row) throw new HttpError(400, "Der Link ist ungültig oder abgelaufen. Fordere bitte einen neuen an.");

        const { salt, hash } = await hashPassword(b.password);

        // Wer den Link aus der Mail öffnen konnte, besitzt die E-Mail-Adresse -> gilt als bestätigt
        db.prepare("UPDATE users SET salt = ?, hash = ?, verified = 1 WHERE id = ?").run(salt, hash, row.user_id);
        db.prepare("DELETE FROM sessions WHERE user_id = ?").run(row.user_id);   // überall abmelden
        promoteIfAdmin(row.user_id);

        res.json({ ok: true, message: "Passwort geändert. Du kannst dich jetzt anmelden." });
    }));

    /* ----- Profil ----- */

    api.put("/me", needUser, limit("profile", 20, 3600 * 1000), ah(async (req, res) => {
        const b = body(req);
        const username = clean(b.username, 24);
        const email = clean(b.email, 120).toLowerCase();
        const u = req.user;

        if (!USERNAME_RE.test(username)) throw new HttpError(400, "Benutzername: 3 bis 24 Zeichen (Buchstaben, Zahlen, _ . -).");
        if (!EMAIL_RE.test(email)) throw new HttpError(400, "Ungültige E-Mail.");

        const taken = db.prepare("SELECT 1 FROM users WHERE (username = ? OR email = ?) AND id != ?").get(username, email, u.id);
        if (taken) throw new HttpError(409, "Name oder E-Mail bereits vergeben.");

        db.prepare("UPDATE users SET username = ? WHERE id = ?").run(username, u.id);

        let message = "Gespeichert.";

        if (email !== u.email.toLowerCase()) {
            const token = createToken(u.id, "email", 24 * 3600 * 1000, email);
            await sendMail(email, "DownloadGames – neue E-Mail-Adresse bestätigen",
                `Hallo ${username},\n\nbestätige diese neue E-Mail-Adresse mit diesem Link (24 Stunden gültig):\n${BASE_URL}/?confirm-email=${token}`);
            message = "Gespeichert. Zur Änderung der E-Mail haben wir einen Bestätigungslink an die neue Adresse gesendet.";
        }

        const fresh = db.prepare("SELECT * FROM users WHERE id = ?").get(u.id);
        res.json({ user: userPayload(accrue(fresh)), message });
    }));

    api.post("/confirm-email", limit("confirm-email", 20, 3600 * 1000), ah(async (req, res) => {
        const row = consumeToken(body(req).token, "email");
        if (!row || !EMAIL_RE.test(row.data || "")) throw new HttpError(400, "Der Link ist ungültig oder abgelaufen.");

        if (db.prepare("SELECT 1 FROM users WHERE email = ? AND id != ?").get(row.data, row.user_id)) {
            throw new HttpError(409, "Diese E-Mail-Adresse ist inzwischen vergeben.");
        }

        db.prepare("UPDATE users SET email = ?, verified = 1 WHERE id = ?").run(row.data, row.user_id);
        promoteIfAdmin(row.user_id);

        res.json({ ok: true });
    }));

    api.post("/change-password", needUser, limit("change-pw", 10, 3600 * 1000), ah(async (req, res) => {
        const b = body(req);
        checkNewPassword(b.newPassword);

        if (!(await checkPassword(req.user, String(b.oldPassword || "").slice(0, 200)))) {
            throw new HttpError(400, "Altes Passwort ist falsch.");
        }

        const { salt, hash } = await hashPassword(b.newPassword);
        const sid = parseCookies(req.headers.cookie).dg_sid;

        db.prepare("UPDATE users SET salt = ?, hash = ? WHERE id = ?").run(salt, hash, req.user.id);
        db.prepare("DELETE FROM sessions WHERE user_id = ? AND token_hash != ?").run(req.user.id, sha(sid));

        res.json({ ok: true, message: "Passwort geändert." });
    }));

    /* ----- Katalog, Kommentare ----- */

    api.get("/games", (req, res) => res.json(publicGames()));

    api.get("/games/:id/comments", (req, res) => {
        const rows = db.prepare(
            "SELECT c.id, u.username AS user, c.text, c.stars, c.date FROM comments c JOIN users u ON u.id = c.user_id WHERE c.game_id = ? ORDER BY c.date"
        ).all(req.params.id);

        res.json(rows.map(r => ({ ...r, date: new Date(r.date).toISOString() })));
    });

    api.post("/games/:id/comments", needUser, limit("comment", 30, 3600 * 1000), (req, res) => {
        const b = body(req);
        const text = clean(b.text, 500);
        const stars = Math.min(5, Math.max(0, Math.round(Number(b.stars) || 0)));

        if (!getGame(req.params.id)) throw new HttpError(404, "Spiel nicht gefunden.");
        if (!text) throw new HttpError(400, "Der Kommentar ist leer.");

        db.prepare(`INSERT INTO comments (game_id, user_id, text, stars, date) VALUES (?,?,?,?,?)
            ON CONFLICT(game_id, user_id) DO UPDATE SET text = excluded.text, stars = excluded.stars, date = excluded.date`)
            .run(req.params.id, req.user.id, text, stars, Date.now());

        res.json({ ok: true });
    });

    api.delete("/comments/:id", needUser, (req, res) => {
        const c = db.prepare("SELECT * FROM comments WHERE id = ?").get(Number(req.params.id) || 0);
        if (!c) throw new HttpError(404, "Kommentar nicht gefunden.");
        if (c.user_id !== req.user.id && req.user.role !== "admin") throw new HttpError(403, "Nicht erlaubt.");

        db.prepare("DELETE FROM comments WHERE id = ?").run(c.id);
        res.json({ ok: true });
    });

    /* ----- Kaufen (Preise kommen immer aus der Datenbank, nie vom Browser) ----- */

    const buyTx = db.transaction((userId, ids) => {
        const u = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
        const owned = new Set(db.prepare("SELECT game_id FROM purchases WHERE user_id = ?").all(userId).map(r => r.game_id));
        const catalog = new Map(allGames().map(g => [g.id, g]));

        const items = [...new Set(ids)].map(id => catalog.get(id)).filter(g => g && !owned.has(g.id));
        if (!items.length) throw new HttpError(400, "Es gibt nichts zu kaufen (Spiel nicht gefunden oder schon in deiner Bibliothek).");

        const cost = g => Math.max(0, Math.round(Number(g.points) || 0));
        const total = items.reduce((s, g) => s + cost(g), 0);

        if (u.points < total) throw new HttpError(400, "Du hast nicht genügend Punkte!");

        db.prepare("UPDATE users SET points = points - ? WHERE id = ?").run(total, userId);

        const ins = db.prepare("INSERT INTO purchases (user_id, game_id, name, cost, type, date) VALUES (?,?,?,?,?,?)");
        items.forEach(g => ins.run(userId, g.id, g.name, cost(g), "Punkte", Date.now()));
    });

    const meAfter = id => userPayload(accrue(db.prepare("SELECT * FROM users WHERE id = ?").get(id)));

    api.post("/buy", needUser, limit("buy", 60, 3600 * 1000), (req, res) => {
        buyTx(req.user.id, [String(body(req).gameId || "")]);
        res.json({ user: meAfter(req.user.id) });
    });

    api.post("/checkout", needUser, limit("buy", 60, 3600 * 1000), (req, res) => {
        const ids = (Array.isArray(body(req).ids) ? body(req).ids : []).map(String).slice(0, 100);
        buyTx(req.user.id, ids);
        res.json({ user: meAfter(req.user.id) });
    });

    const redeemTx = db.transaction((userId, keyText) => {
        const key = db.prepare("SELECT * FROM keys WHERE key = ?").get(keyText);
        if (!key || !key.active || key.used) throw new HttpError(400, "Ungültiger, deaktivierter oder bereits verwendeter Schlüssel.");

        const g = getGame(key.game_id);
        if (!g) throw new HttpError(400, "Das zugehörige Spiel existiert nicht.");

        if (db.prepare("SELECT 1 FROM purchases WHERE user_id = ? AND game_id = ?").get(userId, g.id)) {
            throw new HttpError(400, "Du besitzt dieses Spiel bereits.");
        }

        db.prepare("UPDATE keys SET used = 1, used_by = ? WHERE key = ?").run(userId, keyText);
        db.prepare("INSERT INTO purchases (user_id, game_id, name, cost, type, date) VALUES (?,?,?,?,?,?)")
            .run(userId, g.id, g.name, 0, "Schlüssel", Date.now());
    });

    api.post("/redeem", needUser, limit("redeem", 15, 15 * 60 * 1000), (req, res) => {
        redeemTx(req.user.id, clean(body(req).key, 40).toUpperCase());
        res.json({ user: meAfter(req.user.id), message: "Erfolgreich eingelöst! Das Spiel wurde freigeschaltet." });
    });

    // Download-Link gibt es nur für Besitzer eines als frei markierten Spiels
    api.post("/download", needUser, (req, res) => {
        const g = getGame(body(req).gameId);
        const owns = g && db.prepare("SELECT 1 FROM purchases WHERE user_id = ? AND game_id = ?").get(req.user.id, g.id);

        if (!g || !owns) throw new HttpError(403, "Du musst dieses Spiel zuerst freischalten.");
        if (g.free !== true || !g.downloadUrl || !isHttpUrl(g.downloadUrl)) {
            throw new HttpError(404, "Für dieses Spiel gibt es hier keinen Direkt-Download.");
        }

        res.json({ url: g.downloadUrl });
    });

    /* ----- Admin ----- */

    api.get("/admin/overview", needAdmin, (req, res) => {
        const games = allGames();
        const names = new Map(games.map(g => [g.id, g.name]));
        const pub = publicGames();

        const users = db.prepare(`SELECT u.id, u.username, u.email, u.role, u.verified, u.points,
            (SELECT COUNT(*) FROM purchases p WHERE p.user_id = u.id) AS games FROM users u ORDER BY u.id`).all();

        const keys = db.prepare(`SELECT k.key, k.game_id AS gameId, k.active, k.used, u.username AS usedBy
            FROM keys k LEFT JOIN users u ON u.id = k.used_by ORDER BY k.created DESC LIMIT 500`).all()
            .map(k => ({ ...k, active: !!k.active, used: !!k.used }));

        const comments = db.prepare(`SELECT c.id, c.game_id AS gameId, u.username AS user, c.text, c.stars, c.date
            FROM comments c JOIN users u ON u.id = c.user_id ORDER BY c.date DESC LIMIT 500`).all()
            .map(c => ({ ...c, gameName: names.get(c.gameId) || c.gameId, date: new Date(c.date).toISOString() }));

        res.json({
            games,
            users,
            keys,
            comments,
            stats: {
                users: users.length,
                games: games.length,
                purchases: db.prepare("SELECT COUNT(*) c FROM purchases").get().c,
                comments: comments.length,
                keysUsed: keys.filter(k => k.used).length,
                keysTotal: keys.length,
                top: [...pub].sort((a, b) => b.popularity - a.popularity).slice(0, 5).map(g => ({ name: g.name, popularity: g.popularity }))
            }
        });
    });

    api.post("/admin/keys", needAdmin, (req, res) => {
        const gameId = String(body(req).gameId || "");
        if (!getGame(gameId)) throw new HttpError(404, "Spiel nicht gefunden.");

        const key = randomKey();
        db.prepare("INSERT INTO keys (key, game_id, created) VALUES (?,?,?)").run(key, gameId, Date.now());
        res.json({ key });
    });

    api.post("/admin/keys/deactivate", needAdmin, (req, res) => {
        db.prepare("UPDATE keys SET active = 0 WHERE key = ? AND used = 0").run(String(body(req).key || ""));
        res.json({ ok: true });
    });

    api.post("/admin/grant", needAdmin, (req, res) => {
        const g = getGame(body(req).gameId);
        if (!g) throw new HttpError(404, "Spiel nicht gefunden.");

        db.prepare("INSERT OR IGNORE INTO purchases (user_id, game_id, name, cost, type, date) VALUES (?,?,?,?,?,?)")
            .run(req.user.id, g.id, g.name, 0, "Admin", Date.now());

        res.json({ user: meAfter(req.user.id) });
    });

    api.post("/admin/users/:id/points", needAdmin, (req, res) => {
        const amount = Math.max(-100000, Math.min(100000, Math.round(Number(body(req).amount) || 0)));
        db.prepare("UPDATE users SET points = MAX(0, points + ?) WHERE id = ?").run(amount, Number(req.params.id) || 0);
        res.json({ ok: true });
    });

    api.delete("/admin/users/:id", needAdmin, (req, res) => {
        const id = Number(req.params.id) || 0;
        if (id === req.user.id) throw new HttpError(400, "Du kannst dein eigenes Konto hier nicht löschen.");

        db.prepare("DELETE FROM users WHERE id = ?").run(id);
        res.json({ ok: true });
    });

    api.post("/admin/games", needAdmin, (req, res) => {
        const game = parseGameInput(body(req), null);
        const pos = (db.prepare("SELECT COALESCE(MAX(pos), -1) + 1 AS p FROM games").get().p);

        db.prepare("INSERT INTO games (id, pos, json) VALUES (?,?,?)").run(game.id, pos, JSON.stringify(game));
        res.json({ ok: true, id: game.id });
    });

    api.post("/admin/games/reset", needAdmin, (req, res) => {
        seedGames(true);
        res.json({ ok: true });
    });

    api.put("/admin/games/:id", needAdmin, (req, res) => {
        const existing = getGame(req.params.id);
        if (!existing) throw new HttpError(404, "Spiel nicht gefunden.");

        const game = parseGameInput(body(req), existing);
        db.prepare("UPDATE games SET json = ? WHERE id = ?").run(JSON.stringify(game), existing.id);
        res.json({ ok: true });
    });

    api.delete("/admin/games/:id", needAdmin, (req, res) => {
        const id = String(req.params.id);

        db.transaction(() => {
            db.prepare("DELETE FROM games WHERE id = ?").run(id);
            db.prepare("DELETE FROM comments WHERE game_id = ?").run(id);
            db.prepare("DELETE FROM keys WHERE game_id = ? AND used = 0").run(id);
        })();

        res.json({ ok: true });
    });

    // Fehler als JSON zurückgeben
    api.use((err, req, res, next) => {
        if (err instanceof HttpError) return fail(res, err.status, err.message, err.extra);

        console.error("API-Fehler:", err);
        fail(res, 500, "Serverfehler. Bitte später erneut versuchen.");
    });

    app.use("/api", api);

    // games.js wird vom Server erzeugt (muss VOR express.static eingebunden werden)
    app.get("/games.js", (req, res) => {
        const json = JSON.stringify(publicGames()).replace(/</g, "\\u003c");

        res.set("Cache-Control", "no-store");
        res.type("application/javascript").send(`"use strict";\nconst games = ${json};\n`);
    });

    console.log("Backend: Datenbank bereit, " + allGames().length + " Spiele, " +
        (transporter ? "E-Mail-Versand über SMTP" : "E-Mails nur in der Konsole (SMTP nicht eingerichtet)"));

    return { db, userFromReq, ADMIN_EMAIL };
};