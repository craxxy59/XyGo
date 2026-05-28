#!/usr/bin/env node
/* eslint-disable no-console */
const path = require("path");
const fs = require("fs");
let Database;
try {
  Database = require("better-sqlite3");
} catch (_) {
  Database = require(path.resolve(__dirname, "../../server/node_modules/better-sqlite3"));
}

const args = process.argv.slice(2);
const isDryRun = args.includes("--dry-run");
const dbArg = args.find((a) => a.startsWith("--db="));
const serviceArg = args.find((a) => a.startsWith("--serviceAccount="));

const sqlitePath = dbArg
  ? path.resolve(process.cwd(), dbArg.split("=")[1])
  : path.resolve(__dirname, "../../server/messenger.db");

const servicePath = serviceArg
  ? path.resolve(process.cwd(), serviceArg.split("=")[1])
  : process.env.GOOGLE_APPLICATION_CREDENTIALS
    ? path.resolve(process.cwd(), process.env.GOOGLE_APPLICATION_CREDENTIALS)
    : null;

if (!fs.existsSync(sqlitePath)) {
  console.error("SQLite introuvable:", sqlitePath);
  process.exit(1);
}

if (!isDryRun && (!servicePath || !fs.existsSync(servicePath))) {
  console.error("Service account requis hors dry-run. Utilise --serviceAccount=...");
  process.exit(1);
}

let admin = null;
if (!isDryRun) {
  try {
    admin = require("firebase-admin");
  } catch (_) {
    admin = require(path.resolve(__dirname, "../../server/node_modules/firebase-admin"));
  }
  const serviceAccount = JSON.parse(fs.readFileSync(servicePath, "utf8"));
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: "https://xygo-chat-default-rtdb.europe-west1.firebasedatabase.app"
  });
}

const sqlite = new Database(sqlitePath, { readonly: true });

function normalizeEmail(login, id) {
  const raw = String(login || "").trim().toLowerCase();
  if (raw.includes("@")) return raw;
  const safe = raw.replace(/[^a-z0-9._-]/g, "").slice(0, 24) || `user${id}`;
  return `${safe}@xygochat.app`;
}

function uidForLegacyId(id) {
  return `legacy_${id}`;
}

function dmRoom(uidA, uidB) {
  return [String(uidA), String(uidB)].sort().join("__");
}

async function setIfNotDry(ref, value) {
  if (isDryRun) return;
  await ref.set(value);
}

async function pushIfNotDry(ref, value) {
  if (isDryRun) return;
  await ref.push(value);
}

async function run() {
  const users = sqlite.prepare("SELECT * FROM users").all();
  const messages = sqlite.prepare("SELECT * FROM messages WHERE group_id IS NULL OR group_id = 0").all();
  const groups = sqlite.prepare("SELECT * FROM groups").all();
  const groupMembers = sqlite.prepare("SELECT * FROM group_members").all();
  const groupMessages = sqlite.prepare("SELECT * FROM group_messages").all();
  const notes = sqlite.prepare("SELECT * FROM notes").all();
  const reactions = sqlite.prepare("SELECT * FROM reactions").all();
  const audit = sqlite.prepare("SELECT * FROM audit_log").all();
  const pins = sqlite.prepare("SELECT * FROM pinned_chats").all();

  console.log("=== Migration SQLite -> RTDB ===");
  console.log("dryRun:", isDryRun);
  console.log("sqlite:", sqlitePath);
  console.log("rows", {
    users: users.length,
    messages: messages.length,
    groups: groups.length,
    groupMembers: groupMembers.length,
    groupMessages: groupMessages.length,
    notes: notes.length,
    reactions: reactions.length,
    audit: audit.length,
    pins: pins.length
  });

  const idToUid = new Map();
  users.forEach((u) => idToUid.set(String(u.id), uidForLegacyId(u.id)));

  const mapping = {};
  for (const [id, uid] of idToUid.entries()) mapping[id] = uid;
  const mappingOut = path.resolve(__dirname, "../legacy-id-mapping.json");
  fs.writeFileSync(mappingOut, JSON.stringify(mapping, null, 2), "utf8");
  console.log("mapping écrit:", mappingOut);

  if (isDryRun) {
    console.log("Dry-run terminé (aucune écriture Firebase).");
    return;
  }

  const rtdb = admin.database();

  for (const u of users) {
    const uid = idToUid.get(String(u.id));
    const permissions = (() => { try { return JSON.parse(u.permissions || "[]"); } catch (_) { return []; } })();
    const restrictions = (() => { try { return JSON.parse(u.restrictions || "[]"); } catch (_) { return []; } })();
    await setIfNotDry(rtdb.ref(`users/${uid}`), {
      uid,
      legacy_id: u.id,
      email: normalizeEmail(u.login, u.id),
      login: u.login,
      display_name: u.display_name,
      bio: u.bio || "",
      avatar: u.avatar || null,
      role: u.role || "user",
      permissions,
      restrictions,
      banned: !!u.banned,
      ban_reason: u.ban_reason || "",
      banned_until: u.banned_until ? Date.parse(u.banned_until) : null,
      grade: u.grade || null,
      online: !!u.online,
      last_seen: u.last_seen ? Date.parse(u.last_seen) : null,
      created_at: u.created_at ? Date.parse(u.created_at) : Date.now(),
      msg_count: 0
    });
  }

  for (const m of messages) {
    const senderUid = idToUid.get(String(m.sender_id));
    const receiverUid = idToUid.get(String(m.receiver_id));
    if (!senderUid || !receiverUid) continue;
    const room = dmRoom(senderUid, receiverUid);
    await pushIfNotDry(rtdb.ref(`dm/${room}/messages`), {
      legacy_id: m.id,
      sender_id: senderUid,
      receiver_id: receiverUid,
      content: m.content || "",
      reply_to: m.reply_to || null,
      read: !!m.read,
      deleted: !!m.deleted,
      edited: !!m.edited,
      created_at: m.created_at ? Date.parse(m.created_at) : Date.now()
    });
    await rtdb.ref(`users/${senderUid}/msg_count`).transaction((x) => (x || 0) + 1);
  }

  for (const g of groups) {
    const ownerUid = idToUid.get(String(g.owner_id)) || "legacy_0";
    await setIfNotDry(rtdb.ref(`groups/${g.id}`), {
      id: g.id,
      name: g.name,
      avatar: g.avatar || null,
      owner_id: ownerUid,
      is_public: g.is_public ? 1 : 0,
      created_at: g.created_at ? Date.parse(g.created_at) : Date.now()
    });
  }

  for (const gm of groupMembers) {
    const uid = idToUid.get(String(gm.user_id));
    if (!uid) continue;
    await setIfNotDry(rtdb.ref(`groupMembers/${gm.group_id}/${uid}`), {
      joined_at: gm.joined_at ? Date.parse(gm.joined_at) : Date.now()
    });
  }

  for (const gm of groupMessages) {
    const senderUid = idToUid.get(String(gm.sender_id));
    if (!senderUid) continue;
    await pushIfNotDry(rtdb.ref(`groupMessages/${gm.group_id}`), {
      legacy_id: gm.id,
      groupId: String(gm.group_id),
      sender_id: senderUid,
      content: gm.content || "",
      reply_to: gm.reply_to || null,
      deleted: !!gm.deleted,
      edited: !!gm.edited,
      created_at: gm.created_at ? Date.parse(gm.created_at) : Date.now()
    });
  }

  for (const n of notes) {
    const uid = idToUid.get(String(n.user_id));
    if (!uid) continue;
    await pushIfNotDry(rtdb.ref(`notes/${uid}`), {
      legacy_id: n.id,
      content: n.content || "",
      type: n.type || "text",
      created_at: n.created_at ? Date.parse(n.created_at) : Date.now(),
      expires_at: n.expires_at ? Date.parse(n.expires_at) : Date.now() + 24 * 60 * 60 * 1000
    });
  }

  for (const r of reactions) {
    const uid = idToUid.get(String(r.user_id));
    if (!uid) continue;
    await setIfNotDry(rtdb.ref(`reactions/${r.message_id}/${uid}/${r.emoji}`), {
      created_at: r.created_at ? Date.parse(r.created_at) : Date.now()
    });
  }

  for (const a of audit) {
    const actorUid = idToUid.get(String(a.admin_id)) || "legacy_0";
    await pushIfNotDry(rtdb.ref("audit"), {
      actor_uid: actorUid,
      action: a.action || "",
      target: a.target || "",
      detail: a.detail || "",
      created_at: a.created_at ? Date.parse(a.created_at) : Date.now()
    });
  }

  for (const p of pins) {
    const uid = idToUid.get(String(p.user_id));
    const targetUid = idToUid.get(String(p.target_id));
    if (!uid || !targetUid) continue;
    const key = `${p.target_type || "user"}:${targetUid}`;
    await setIfNotDry(rtdb.ref(`pins/${uid}/${key}`), {
      target_id: targetUid,
      target_type: p.target_type || "user",
      pinned_at: p.pinned_at ? Date.parse(p.pinned_at) : Date.now()
    });
  }

  console.log("Import terminé.");
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Erreur migration:", err);
    process.exit(1);
  });
