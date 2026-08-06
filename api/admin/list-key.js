// api/admin/list-keys.js — POST /api/admin/list-keys
import initSqlJs from "sql.js";
import { readFileSync, existsSync } from "fs";
import path from "path";
import { tmpdir } from "os";

const DB_PATH = process.env.DB_PATH || path.join(tmpdir(), "grow_keys.db");

function isAuthorized(body, db) {
    const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "changeme_admin_secret";
    if (body?.adminToken === ADMIN_TOKEN) return true;
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
    if (req.method !== "POST") return res.status(405).json({ ok: false });

    let body = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch(_) { body = {}; } }

    if (!existsSync(DB_PATH)) return res.json({ ok: true, keys: [], total: 0 });

    try {
        const SQL = await initSqlJs();
        const db  = new SQL.Database(readFileSync(DB_PATH));

        if (!isAuthorized(body, db)) {
            db.close();
            return res.status(403).json({ ok: false, message: "Unauthorized" });
        }

        const stmt = db.prepare(
            "SELECT key_string, username, tier, expiry, active, uses, created_at, last_used FROM keys ORDER BY created_at DESC"
        );
        const rows = [];
        while (stmt.step()) rows.push(stmt.getAsObject());
        stmt.free();
        db.close();

        return res.json({ ok: true, total: rows.length, keys: rows });
    } catch(err) {
        return res.status(500).json({ ok: false, message: err.message });
    }
}
