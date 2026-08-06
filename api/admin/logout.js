// api/admin/logout.js — POST /api/admin/logout
// Body: { token }
import initSqlJs from "sql.js";
import { readFileSync, writeFileSync, existsSync } from "fs";
import path from "path";
import { tmpdir } from "os";

const DB_PATH = process.env.DB_PATH || path.join(tmpdir(), "grow_keys.db");

export default async function handler(req, res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") return res.status(200).end();

    let body = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch(_) { body = {}; } }

    const { token } = body || {};
    if (!token) return res.json({ ok: true }); // idempotent

    try {
        if (existsSync(DB_PATH)) {
            const SQL = await initSqlJs();
            const db  = new SQL.Database(readFileSync(DB_PATH));
            db.run("DELETE FROM admin_sessions WHERE token = ?", [token]);
            writeFileSync(DB_PATH, Buffer.from(db.export()));
            db.close();
        }
        return res.json({ ok: true, message: "Logged out" });
    } catch(err) {
        return res.json({ ok: true }); // always succeed logout
    }
}
