// api/admin/login.js — POST /api/admin/login
// Body: { username, password }
// Returns: { ok, token, username, role }
import initSqlJs from "sql.js";
import { readFileSync, writeFileSync, existsSync } from "fs";
import path from "path";
import { tmpdir } from "os";
import crypto from "crypto";

const DB_PATH = process.env.DB_PATH || path.join(tmpdir(), "grow_keys.db");
const SESSION_TTL_HOURS = 8;

async function getDb() {
    const SQL = await initSqlJs();
    if (existsSync(DB_PATH)) return new SQL.Database(readFileSync(DB_PATH));
    const db = new SQL.Database();
    db.run(`
        CREATE TABLE IF NOT EXISTS keys (
            id INTEGER PRIMARY KEY AUTOINCREMENT, key_string TEXT NOT NULL UNIQUE,
            username TEXT NOT NULL, tier TEXT NOT NULL DEFAULT 'free',
            expiry TEXT NOT NULL DEFAULT '2099-12-31', active INTEGER NOT NULL DEFAULT 1,
            uses INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')), last_used TEXT
        );
        CREATE TABLE IF NOT EXISTS admin_sessions (
            token TEXT NOT NULL UNIQUE, username TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')), expires_at TEXT NOT NULL
        );
    `);
    writeFileSync(DB_PATH, Buffer.from(db.export()));
    return db;
}

function saveDb(db) {
    try { writeFileSync(DB_PATH, Buffer.from(db.export())); } catch(e) {}
}

export default async function handler(req, res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") return res.status(200).end();
    if (req.method !== "POST") return res.status(405).json({ ok: false, message: "Method not allowed" });

    let body = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch(_) { body = {}; } }

    const { username, password } = body || {};
    if (!username || !password) return res.status(400).json({ ok: false, message: "Username and password required" });

    // Check against ADMIN_TOKEN env OR static credentials
    const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "changeme_admin_secret";
    const ADMIN_USER  = process.env.ADMIN_USER  || "admin";

    const isValid = (username === ADMIN_USER && password === ADMIN_TOKEN);
    if (!isValid) {
        return res.status(401).json({ ok: false, message: "Invalid credentials" });
    }

    try {
        const db    = await getDb();
        const token = crypto.randomBytes(32).toString("hex");
        const exp   = new Date(Date.now() + SESSION_TTL_HOURS * 3_600_000).toISOString();

        // Ensure session table exists (migration)
        db.run(`CREATE TABLE IF NOT EXISTS admin_sessions (
            token TEXT NOT NULL UNIQUE, username TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')), expires_at TEXT NOT NULL
        );`);

        // Purge old sessions for this user
        db.run("DELETE FROM admin_sessions WHERE username = ? OR expires_at < datetime('now')", [username]);
        db.run("INSERT INTO admin_sessions (token, username, expires_at) VALUES (?, ?, ?)", [token, username, exp]);
        saveDb(db);
        db.close();

        return res.json({ ok: true, token, username, role: "admin", expiresAt: exp });
    } catch(err) {
        console.error("[login]", err);
        return res.status(500).json({ ok: false, message: "Server error" });
    }
}
