// api/admin/add-key.js — POST /api/admin/add-key
// Body: { adminToken, key, username, tier, expiry }
// OR auth via session: { token, key, username, tier, expiry }
import initSqlJs from "sql.js";
import { readFileSync, writeFileSync, existsSync } from "fs";
import path from "path";
import { tmpdir } from "os";

const DB_PATH = process.env.DB_PATH || path.join(tmpdir(), "grow_keys.db");

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
    `);
    writeFileSync(DB_PATH, Buffer.from(db.export()));
    return db;
}

function saveDb(db) {
    try { writeFileSync(DB_PATH, Buffer.from(db.export())); } catch(e) {}
}

function isAuthorized(body, db) {
    const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "changeme_admin_secret";
    // legacy token auth
    if (body?.adminToken === ADMIN_TOKEN) return true;
    // session token auth
    if (body?.token) {
        try {
            db.run("CREATE TABLE IF NOT EXISTS admin_sessions (token TEXT NOT NULL UNIQUE, username TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), expires_at TEXT NOT NULL);");
            const st = db.prepare("SELECT token FROM admin_sessions WHERE token = ? AND expires_at > datetime('now') LIMIT 1");
            st.bind([body.token]);
            const valid = st.step();
            st.free();
            return valid;
        } catch(_) { return false; }
    }
    return false;
}

export default async function handler(req, res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") return res.status(200).end();
    if (req.method !== "POST") return res.status(405).json({ ok: false, message: "Method not allowed" });

    let body = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch(_) { body = {}; } }

    try {
        const db = await getDb();

        if (!isAuthorized(body, db)) {
            db.close();
            return res.status(403).json({ ok: false, message: "Unauthorized" });
        }

        const { key, username, tier = "vip", expiry = "2099-12-31" } = body || {};
        if (!key || !username) {
            db.close();
            return res.status(400).json({ ok: false, message: "key and username required" });
        }

        const cleanKey = key.trim().toUpperCase();

        db.run(
            `INSERT OR REPLACE INTO keys (key_string, username, tier, expiry, active, uses, created_at)
             VALUES (?, ?, ?, ?, 1, 0, datetime('now'))`,
            [cleanKey, username.trim(), tier, expiry]
        );
        saveDb(db);
        db.close();

        return res.json({ ok: true, message: "Key added", key: cleanKey, record: { username, tier, expiry, active: true } });
    } catch(err) {
        console.error("[add-key]", err);
        return res.status(500).json({ ok: false, message: "Server error: " + err.message });
    }
}
