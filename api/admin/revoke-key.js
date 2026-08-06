// api/admin/revoke-key.js — POST /api/admin/revoke-key
// Body: { adminToken, key }

import initSqlJs from "sql.js";
import { readFileSync, writeFileSync, existsSync } from "fs";
import path from "path";
import { tmpdir } from "os";

const DB_PATH = process.env.DB_PATH || path.join(tmpdir(), "grow_keys.db");

export default async function handler(req, res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") return res.status(200).end();
    if (req.method !== "POST")   return res.status(405).json({ ok: false });

    let body = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch (_) { body = {}; } }

    const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "changeme_admin_secret";
    if ((body?.adminToken) !== ADMIN_TOKEN) {
        return res.status(403).json({ ok: false, message: "Unauthorized" });
    }

    const key = (body?.key || "").trim();
    if (!key) return res.status(400).json({ ok: false, message: "key required" });

    if (!existsSync(DB_PATH)) {
        return res.status(404).json({ ok: false, message: "Database not found" });
    }

    try {
        const SQL = await initSqlJs();
        const db  = new SQL.Database(readFileSync(DB_PATH));

        db.run("UPDATE keys SET active = 0 WHERE key_string = ?", [key]);
        writeFileSync(DB_PATH, Buffer.from(db.export()));
        db.close();

        return res.status(200).json({ ok: true, message: "Key revoked: " + key });

    } catch (err) {
        return res.status(500).json({ ok: false, message: err.message });
    }
}
