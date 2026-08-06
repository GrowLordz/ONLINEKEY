// api/verify.js — POST /api/verify
import initSqlJs from "sql.js";
import { readFileSync, writeFileSync, existsSync } from "fs";
import path from "path";
import { tmpdir } from "os";

const DB_PATH = process.env.DB_PATH || path.join(tmpdir(), "grow_keys.db");

let _db = null;
let _SQL = null;

async function getDb() {
    if (_db) return _db;
    if (!_SQL) _SQL = await initSqlJs();
    if (existsSync(DB_PATH)) {
        _db = new _SQL.Database(readFileSync(DB_PATH));
    } else {
        _db = new _SQL.Database();
        _db.run(`
            CREATE TABLE IF NOT EXISTS keys (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                key_string  TEXT    NOT NULL UNIQUE,
                username    TEXT    NOT NULL,
                tier        TEXT    NOT NULL DEFAULT 'free',
                expiry      TEXT    NOT NULL DEFAULT '2099-12-31',
                active      INTEGER NOT NULL DEFAULT 1,
                uses        INTEGER NOT NULL DEFAULT 0,
                created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
                last_used   TEXT
            );
            CREATE TABLE IF NOT EXISTS admin_sessions (
                token       TEXT    NOT NULL UNIQUE,
                username    TEXT    NOT NULL,
                created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
                expires_at  TEXT    NOT NULL
            );
        `);
        saveDb(_db);
    }
    return _db;
}

export function saveDb(db) {
    try { writeFileSync(DB_PATH, Buffer.from(db.export())); } catch(e) { console.error("[DB]", e.message); }
}

function isExpired(d) {
    if (!d || d === "never" || d === "2099-12-31") return false;
    return new Date(d) < new Date();
}

export default async function handler(req, res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") return res.status(200).end();
    if (req.method !== "POST") return res.status(405).json({ valid: false, message: "Method not allowed" });

    let body = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch(_) { body = {}; } }

    const key = (body?.key || "").trim().toUpperCase();
    if (!key) return res.status(400).json({ valid: false, message: "No key provided" });

    try {
        const db = await getDb();
        const stmt = db.prepare("SELECT * FROM keys WHERE key_string = :k LIMIT 1");
        const row  = stmt.getAsObject({ ":k": key });
        stmt.free();

        if (!row?.key_string)         return res.json({ valid: false, message: "Key not found" });
        if (!row.active)              return res.json({ valid: false, message: "Key has been revoked" });
        if (isExpired(row.expiry))    return res.json({ valid: false, message: "Key has expired" });

        db.run("UPDATE keys SET uses = uses+1, last_used = datetime('now') WHERE key_string = ?", [key]);
        saveDb(db);

        return res.json({ valid: true, message: "OK", username: row.username, expiry: row.expiry, tier: row.tier, uses: (row.uses||0)+1 });
    } catch(err) {
        console.error("[verify]", err);
        return res.status(500).json({ valid: false, message: "Server error" });
    }
}
