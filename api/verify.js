// api/verify.js — POST /api/verify
// Body: { key, game, version }
// Uses better-sqlite3 (Vercel supports native modules via ncc bundle or edge workaround)
// For Vercel: use @vercel/edge + SQLite via sql.js (pure JS, no native binding needed)

import initSqlJs from "sql.js";
import { readFileSync, writeFileSync, existsSync } from "fs";
import path from "path";
import { tmpdir } from "os";

// SQLite DB lives in /tmp (Vercel writable temp, persists within warm lambda)
// For true persistence across cold starts: mount Vercel KV or use Turso.
// For self-hosted / Railway / Render: DB path can be a volume mount.
const DB_PATH = process.env.DB_PATH || path.join(tmpdir(), "grow_keys.db");

let _db = null;

async function getDb() {
    if (_db) return _db;

    const SQL = await initSqlJs();

    if (existsSync(DB_PATH)) {
        const fileBuffer = readFileSync(DB_PATH);
        _db = new SQL.Database(fileBuffer);
    } else {
        _db = new SQL.Database();
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
        `);
        _saveDb(_db);
    }

    return _db;
}

function _saveDb(db) {
    try {
        const data = db.export();
        writeFileSync(DB_PATH, Buffer.from(data));
    } catch (e) {
        console.error("[GrowKey] Failed to save DB:", e.message);
    }
}

function isExpired(expiryStr) {
    if (!expiryStr || expiryStr === "never" || expiryStr === "2099-12-31") return false;
    return new Date(expiryStr) < new Date();
}

export default async function handler(req, res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") return res.status(200).end();
    if (req.method !== "POST")   return res.status(405).json({ valid: false, message: "Method not allowed" });

    let body = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch (_) { body = {}; } }

    const key = (body?.key || "").trim();
    if (!key) return res.status(400).json({ valid: false, message: "No key provided" });

    try {
        const db = await getDb();

        const stmt   = db.prepare("SELECT * FROM keys WHERE key_string = :key LIMIT 1");
        const result = stmt.getAsObject({ ":key": key });
        stmt.free();

        if (!result || !result.key_string) {
            return res.status(200).json({ valid: false, message: "Invalid key" });
        }

        if (!result.active || result.active === 0) {
            return res.status(200).json({ valid: false, message: "Key has been deactivated" });
        }

        if (isExpired(result.expiry)) {
            return res.status(200).json({ valid: false, message: "Key has expired" });
        }

        // Bump use count + last_used
        db.run(
            "UPDATE keys SET uses = uses + 1, last_used = datetime('now') WHERE key_string = ?",
            [key]
        );
        _saveDb(db);

        return res.status(200).json({
            valid:    true,
            message:  "Key validated successfully",
            username: result.username,
            expiry:   result.expiry,
            tier:     result.tier,
            uses:     (result.uses || 0) + 1,
        });

    } catch (err) {
        console.error("[GrowKey] DB error:", err);
        return res.status(500).json({ valid: false, message: "Server error" });
    }
}
