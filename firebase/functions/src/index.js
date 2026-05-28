const { onRequest } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.database();
const ADMIN_EMAILS = new Set(["hhugo.liegeois@gmail.com", "craxxy5909@xygochat.app"]);

const MAX_NOTE_LENGTH = 200;
const MAX_MESSAGE_LENGTH = 2000;
const MAX_INLINE_IMAGE_SIZE = 700000;

function json(res, status, payload) {
  res.status(status).set("Content-Type", "application/json").send(JSON.stringify(payload));
}

function sanitize(str) {
  if (typeof str !== "string") return "";
  return str
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, "")
    .trim();
}

async function getAuthUid(req) {
  const authHeader = req.headers.authorization || "";
  if (!authHeader.startsWith("Bearer ")) return null;
  const idToken = authHeader.slice("Bearer ".length);
  try {
    const decoded = await admin.auth().verifyIdToken(idToken);
    return decoded.uid || null;
  } catch (_) {
    return null;
  }
}

async function getUser(uid) {
  if (!uid) return null;
  const snap = await db.ref(`users/${uid}`).get();
  if (!snap.exists()) return null;
  return { uid, ...snap.val() };
}

async function ensureAdminFromEmail(uid, userObj) {
  const email = String(userObj?.email || "").toLowerCase();
  if (!ADMIN_EMAILS.has(email)) return userObj;
  if (userObj?.role === "admin") return userObj;
  await db.ref(`users/${uid}/role`).set("admin");
  return { ...userObj, role: "admin" };
}

function isAdmin(user) {
  return user?.role === "admin";
}

function isModerator(user) {
  return user?.role === "moderator" || user?.role === "admin";
}

function hasPermission(user, perm) {
  if (isModerator(user)) return true;
  return Array.isArray(user?.permissions) && user.permissions.includes(perm);
}

function dmRoomId(uidA, uidB) {
  return [String(uidA), String(uidB)].sort().join("__");
}

async function writeAudit(actorUid, action, target = "", detail = "") {
  await db.ref("audit").push({
    actor_uid: actorUid,
    action,
    target,
    detail,
    created_at: Date.now()
  });
}

async function listUsers() {
  const snap = await db.ref("users").get();
  const out = [];
  snap.forEach((child) => {
    out.push({ uid: child.key, ...child.val() });
  });
  return out;
}

function toLegacyNumericId(user) {
  if (user?.legacy_id) return user.legacy_id;
  const m = String(user?.uid || "").match(/^legacy_(\d+)$/);
  return m ? Number(m[1]) : String(user?.uid || "");
}

async function resolveUid(value) {
  const raw = String(value || "");
  if (!raw) return "";
  const direct = await db.ref(`users/${raw}`).get();
  if (direct.exists()) return raw;
  if (/^\d+$/.test(raw)) {
    const candidate = `legacy_${raw}`;
    const snap = await db.ref(`users/${candidate}`).get();
    if (snap.exists()) return candidate;
  }
  return raw;
}

async function listDmMessagesBetween(uidA, uidB, limit = 300) {
  const room = dmRoomId(uidA, uidB);
  const snap = await db.ref(`dm/${room}/messages`).limitToLast(limit).get();
  const out = [];
  snap.forEach((m) => out.push({ id: m.key, ...m.val() }));
  return out;
}

exports.api = onRequest({ region: "europe-west1", cors: true }, async (req, res) => {
  try {
    const uid = await getAuthUid(req);
    const path = (req.path || "/").replace(/\/+$/, "") || "/";

    if (!uid && !["/health"].includes(path)) {
      return json(res, 401, { error: "Non authentifié" });
    }

    if (path === "/health") {
      return json(res, 200, { ok: true, service: "xygo-firebase-api" });
    }

    let me = await getUser(uid);
    if (!me) return json(res, 403, { error: "Profil utilisateur introuvable" });
    me = await ensureAdminFromEmail(uid, me);
    if (me.banned) return json(res, 403, { error: "Compte banni", reason: me.ban_reason || "" });

    if (path === "/users" && req.method === "GET") {
      const users = await listUsers();
      return json(res, 200, users.map((u) => ({
        id: toLegacyNumericId(u),
        uid: u.uid,
        login: u.email || "",
        display_name: u.display_name || "Utilisateur",
        avatar: u.avatar || null,
        role: u.role || "user",
        permissions: u.permissions || [],
        restrictions: u.restrictions || [],
        grade: u.grade || null,
        online: !!u.online,
        banned: !!u.banned,
        last_seen: u.last_seen || null,
        msg_count: u.msg_count || 0
      })));
    }

    if (path === "/groups" && req.method === "GET") {
      const groupsSnap = await db.ref("groups").get();
      const groups = [];
      groupsSnap.forEach((g) => groups.push({ id: g.key, ...g.val() }));
      return json(res, 200, groups);
    }

    if (path === "/groups" && req.method === "POST") {
      const name = sanitize(req.body?.name || "");
      if (!name) return json(res, 400, { error: "Nom requis" });
      const ref = db.ref("groups").push();
      const created = {
        name,
        owner_id: uid,
        is_public: req.body?.isPublic ? 1 : 0,
        member_count: 1,
        created_at: Date.now()
      };
      await ref.set(created);
      await db.ref(`groupMembers/${ref.key}/${uid}`).set({ joined_at: Date.now() });
      await writeAudit(uid, "group_create", ref.key, name);
      return json(res, 201, { id: ref.key, ...created });
    }

    const groupMessagesMatch = path.match(/^\/groups\/([^/]+)\/messages$/);
    if (groupMessagesMatch && req.method === "GET") {
      const groupId = groupMessagesMatch[1];
      const msgsSnap = await db.ref(`groupMessages/${groupId}`).limitToLast(200).get();
      const out = [];
      msgsSnap.forEach((m) => out.push({ id: m.key, ...m.val() }));
      return json(res, 200, out);
    }

    const groupMembersMatch = path.match(/^\/groups\/([^/]+)\/members$/);
    if (groupMembersMatch && req.method === "GET") {
      const groupId = groupMembersMatch[1];
      const membersSnap = await db.ref(`groupMembers/${groupId}`).get();
      const users = await listUsers();
      const byUid = new Map(users.map((u) => [u.uid, u]));
      const out = [];
      membersSnap.forEach((m) => {
        const u = byUid.get(m.key);
        if (u) out.push({ id: u.uid, display_name: u.display_name || "Utilisateur", online: !!u.online, role: u.role || "user" });
      });
      return json(res, 200, out);
    }

    const groupLeaveMatch = path.match(/^\/groups\/([^/]+)\/leave$/);
    if (groupLeaveMatch && req.method === "POST") {
      const groupId = groupLeaveMatch[1];
      await db.ref(`groupMembers/${groupId}/${uid}`).remove();
      await writeAudit(uid, "group_leave", groupId);
      return json(res, 200, { ok: true });
    }

    const dmMatch = path.match(/^\/messages\/([^/]+)$/);
    if (dmMatch && req.method === "GET") {
      const targetId = await resolveUid(dmMatch[1]);
      const roomId = dmRoomId(uid, targetId);
      const msgsSnap = await db.ref(`dm/${roomId}/messages`).limitToLast(200).get();
      const out = [];
      msgsSnap.forEach((m) => out.push({ id: m.key, ...m.val() }));
      return json(res, 200, out);
    }

    const dmSearchMatch = path.match(/^\/messages\/search\/([^/]+)$/);
    if (dmSearchMatch && req.method === "GET") {
      const targetId = await resolveUid(dmSearchMatch[1]);
      const queryText = String(req.query?.q || "").toLowerCase();
      const msgs = await listDmMessagesBetween(uid, targetId, 500);
      const users = await listUsers();
      const byUid = new Map(users.map((u) => [u.uid, u]));
      const filtered = !queryText
        ? msgs
        : msgs.filter((m) => String(m.content || "").toLowerCase().includes(queryText));
      return json(res, 200, filtered.slice(0, 100).map((m) => ({
        ...m,
        sender_name: byUid.get(m.sender_id)?.display_name || "Utilisateur"
      })));
    }

    const reactMatch = path.match(/^\/messages\/([^/]+)\/react$/);
    if (reactMatch && req.method === "POST") {
      const messageId = reactMatch[1];
      const emoji = sanitize(req.body?.emoji || "");
      if (!emoji) return json(res, 400, { error: "Emoji requis" });
      const ref = db.ref(`reactions/${messageId}/${uid}/${emoji}`);
      const snap = await ref.get();
      if (snap.exists()) await ref.remove();
      else await ref.set({ created_at: Date.now() });
      return json(res, 200, { ok: true });
    }

    const messageEditDeleteMatch = path.match(/^\/messages\/([^/]+)$/);
    if (messageEditDeleteMatch && req.method === "PUT") {
      const messageId = messageEditDeleteMatch[1];
      const content = String(req.body?.content || "");
      if (!content) return json(res, 400, { error: "Contenu requis" });
      const dmRoot = await db.ref("dm").get();
      let updated = false;
      dmRoot.forEach((roomNode) => {
        roomNode.child("messages").forEach((msgNode) => {
          if (msgNode.key === messageId) {
            const msg = msgNode.val() || {};
            if (msg.sender_id === uid || hasPermission(me, "edit_msg")) {
              db.ref(`dm/${roomNode.key}/messages/${messageId}`).update({ content, edited: true });
              updated = true;
            }
          }
        });
      });
      return updated ? json(res, 200, { ok: true }) : json(res, 404, { error: "Message introuvable" });
    }
    if (messageEditDeleteMatch && req.method === "DELETE") {
      const messageId = messageEditDeleteMatch[1];
      const dmRoot = await db.ref("dm").get();
      let deleted = false;
      dmRoot.forEach((roomNode) => {
        roomNode.child("messages").forEach((msgNode) => {
          if (msgNode.key === messageId) {
            const msg = msgNode.val() || {};
            if (msg.sender_id === uid || hasPermission(me, "delete_msg")) {
              db.ref(`dm/${roomNode.key}/messages/${messageId}`).update({ deleted: true, content: "[Message supprimé]" });
              deleted = true;
            }
          }
        });
      });
      return deleted ? json(res, 200, { ok: true }) : json(res, 404, { error: "Message introuvable" });
    }

    if (path === "/pin" && req.method === "POST") {
      const targetId = String(req.body?.targetId || "");
      const targetType = String(req.body?.targetType || "user");
      if (!targetId) return json(res, 400, { error: "targetId requis" });
      const key = `${targetType}:${targetId}`;
      const ref = db.ref(`pins/${uid}/${key}`);
      const existing = await ref.get();
      if (existing.exists()) {
        await ref.remove();
        return json(res, 200, { pinned: false });
      }
      await ref.set({ target_id: targetId, target_type: targetType, pinned_at: Date.now() });
      return json(res, 200, { pinned: true });
    }

    const notesPath = path === "/notes";
    if (notesPath && req.method === "GET") {
      const notesSnap = await db.ref("notes").get();
      const users = await listUsers();
      const userMap = new Map(users.map((u) => [u.uid, u]));
      const out = [];
      notesSnap.forEach((uNode) => {
        uNode.forEach((n) => {
          const val = n.val();
          if (!val) return;
          out.push({
            id: n.key,
            user_id: uNode.key,
            display_name: userMap.get(uNode.key)?.display_name || "Utilisateur",
            content: val.content || "",
            type: val.type || "text",
            created_at: val.created_at || Date.now()
          });
        });
      });
      out.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
      return json(res, 200, out.slice(0, 100));
    }

    if (notesPath && req.method === "POST") {
      const content = sanitize(req.body?.content || "");
      const type = req.body?.type === "emoji" ? "emoji" : "text";
      if (!content) return json(res, 400, { error: "Contenu requis" });
      if (content.length > MAX_NOTE_LENGTH) return json(res, 400, { error: "Note trop longue" });
      const ref = db.ref(`notes/${uid}`).push();
      await ref.set({ content, type, created_at: Date.now(), expires_at: Date.now() + 24 * 60 * 60 * 1000 });
      return json(res, 201, { id: ref.key });
    }

    if (notesPath && req.method === "DELETE") {
      await db.ref(`notes/${uid}`).remove();
      return json(res, 200, { ok: true });
    }

    if (path === "/leaderboard" && req.method === "GET") {
      const users = await listUsers();
      users.sort((a, b) => (b.msg_count || 0) - (a.msg_count || 0));
      return json(res, 200, users.slice(0, 100).map((u) => ({
        id: toLegacyNumericId(u),
        display_name: u.display_name || "Utilisateur",
        avatar: u.avatar || null,
        role: u.role || "user",
        grade: u.grade || null,
        msg_count: u.msg_count || 0
      })));
    }

    if (path === "/users/stats" && req.method === "GET") {
      const users = await listUsers();
      const meStats = users.find((u) => u.uid === uid) || {};
      return json(res, 200, {
        messages: meStats.msg_count || 0,
        reactions: meStats.reaction_count || 0,
        joined: meStats.created_at || Date.now()
      });
    }

    const userProfilePath = path.match(/^\/users\/([^/]+)\/profile$/);
    if (userProfilePath && req.method === "GET") {
      const profileUid = await resolveUid(userProfilePath[1]);
      const profile = await getUser(profileUid);
      if (!profile) return json(res, 404, { error: "Utilisateur introuvable" });
      return json(res, 200, {
        id: profileUid,
        uid: profileUid,
        display_name: profile.display_name || "Utilisateur",
        avatar: profile.avatar || null,
        bio: profile.bio || "",
        role: profile.role || "user",
        grade: profile.grade || null,
        online: !!profile.online,
        last_seen: profile.last_seen || null,
        msg_count: profile.msg_count || 0
      });
    }

    if (path === "/users/bio" && req.method === "PUT") {
      if ((me.restrictions || []).includes("no_bio")) return json(res, 403, { error: "Bio restreinte" });
      const bio = sanitize(req.body?.bio || "").slice(0, 100);
      await db.ref(`users/${uid}/bio`).set(bio);
      return json(res, 200, { ok: true });
    }

    if (path === "/users/display-name" && req.method === "PUT") {
      if ((me.restrictions || []).includes("no_rename")) return json(res, 403, { error: "Pseudo restreint" });
      const displayName = sanitize(req.body?.display_name || "").slice(0, 30);
      if (!displayName) return json(res, 400, { error: "Pseudo invalide" });
      await db.ref(`users/${uid}/display_name`).set(displayName);
      return json(res, 200, { ok: true });
    }

    if (path === "/users/avatar" && req.method === "PUT") {
      if ((me.restrictions || []).includes("no_avatar")) return json(res, 403, { error: "Avatar restreint" });
      const avatar = String(req.body?.avatar || "");
      if (avatar && avatar.length > MAX_INLINE_IMAGE_SIZE) return json(res, 400, { error: "Avatar trop lourd" });
      await db.ref(`users/${uid}/avatar`).set(avatar || null);
      return json(res, 200, { ok: true });
    }

    if (path === "/auth/verify" && req.method === "GET") {
      return json(res, 200, {
        id: uid,
        uid,
        display_name: me.display_name || "Utilisateur",
        role: me.role || "user",
        permissions: me.permissions || [],
        restrictions: me.restrictions || []
      });
    }

    if (path === "/me" && req.method === "GET") {
      return json(res, 200, {
        id: uid,
        uid,
        display_name: me.display_name || "Utilisateur",
        email: me.email || "",
        bio: me.bio || "",
        avatar: me.avatar || null,
        role: me.role || "user",
        permissions: me.permissions || [],
        restrictions: me.restrictions || [],
        grade: me.grade || null
      });
    }

    if (path === "/admin/stats" && req.method === "GET") {
      if (!isAdmin(me)) return json(res, 403, { error: "Accès refusé" });
      const users = await listUsers();
      const onlineUsers = users.filter((u) => u.online).length;
      const bannedUsers = users.filter((u) => u.banned).length;
      const totalMessagesSnap = await db.ref("dm").get();
      let totalMessages = 0;
      totalMessagesSnap.forEach((roomNode) => {
        const msgs = roomNode.child("messages");
        totalMessages += msgs.exists() ? msgs.numChildren() : 0;
      });
      return json(res, 200, {
        totalUsers: users.length,
        onlineUsers,
        bannedUsers,
        totalMessages,
        todayMessages: 0,
        newUsers7d: 0
      });
    }

    if (path === "/admin/users" && req.method === "GET") {
      if (!isAdmin(me)) return json(res, 403, { error: "Accès refusé" });
      const users = await listUsers();
      return json(res, 200, users.map((u) => ({
        id: toLegacyNumericId(u),
        uid: u.uid,
        login: u.email || "",
        display_name: u.display_name || "Utilisateur",
        role: u.role || "user",
        online: !!u.online,
        banned: !!u.banned,
        banned_until: u.banned_until || null,
        permissions: JSON.stringify(u.permissions || []),
        restrictions: JSON.stringify(u.restrictions || []),
        msg_count: u.msg_count || 0,
        grade: u.grade || null
      })));
    }

    const adminRolePath = path.match(/^\/admin\/users\/([^/]+)\/role$/);
    if (adminRolePath && req.method === "POST") {
      if (!isAdmin(me)) return json(res, 403, { error: "Accès refusé" });
      const targetUid = await resolveUid(adminRolePath[1]);
      const role = ["user", "moderator", "admin"].includes(req.body?.role) ? req.body.role : "user";
      await db.ref(`users/${targetUid}/role`).set(role);
      await writeAudit(uid, "set_role", targetUid, role);
      return json(res, 200, { ok: true });
    }

    const adminGradePath = path.match(/^\/admin\/users\/([^/]+)\/grade$/);
    if (adminGradePath && req.method === "PUT") {
      if (!isAdmin(me)) return json(res, 403, { error: "Accès refusé" });
      const targetUid = await resolveUid(adminGradePath[1]);
      const grade = sanitize(req.body?.grade || "");
      await db.ref(`users/${targetUid}/grade`).set(grade || null);
      await writeAudit(uid, "set_grade", targetUid, grade);
      return json(res, 200, { ok: true });
    }

    const adminPermPath = path.match(/^\/admin\/users\/([^/]+)\/permissions$/);
    if (adminPermPath && req.method === "PUT") {
      if (!isAdmin(me)) return json(res, 403, { error: "Accès refusé" });
      const targetUid = await resolveUid(adminPermPath[1]);
      const permissions = Array.isArray(req.body?.permissions) ? req.body.permissions : [];
      await db.ref(`users/${targetUid}/permissions`).set(permissions);
      await writeAudit(uid, "set_permissions", targetUid, JSON.stringify(permissions));
      return json(res, 200, { ok: true });
    }

    if (adminPermPath && req.method === "GET") {
      if (!isAdmin(me)) return json(res, 403, { error: "Accès refusé" });
      const targetUid = await resolveUid(adminPermPath[1]);
      const target = await getUser(targetUid);
      return json(res, 200, { permissions: target?.permissions || [] });
    }

    const adminRestrPath = path.match(/^\/admin\/users\/([^/]+)\/restrictions$/);
    if (adminRestrPath && req.method === "PUT") {
      if (!isAdmin(me)) return json(res, 403, { error: "Accès refusé" });
      const targetUid = await resolveUid(adminRestrPath[1]);
      const restrictions = Array.isArray(req.body?.restrictions) ? req.body.restrictions : [];
      await db.ref(`users/${targetUid}/restrictions`).set(restrictions);
      await writeAudit(uid, "set_restrictions", targetUid, JSON.stringify(restrictions));
      return json(res, 200, { ok: true });
    }

    if (adminRestrPath && req.method === "GET") {
      if (!isAdmin(me)) return json(res, 403, { error: "Accès refusé" });
      const targetUid = await resolveUid(adminRestrPath[1]);
      const target = await getUser(targetUid);
      return json(res, 200, { restrictions: target?.restrictions || [] });
    }

    const modBanPath = path.match(/^\/mod\/users\/([^/]+)\/ban$/);
    if (modBanPath && req.method === "POST") {
      if (!isModerator(me) && !hasPermission(me, "ban_temp")) return json(res, 403, { error: "Accès refusé" });
      const targetUid = await resolveUid(modBanPath[1]);
      const durationMin = Number(req.body?.duration || 0);
      const until = durationMin > 0 ? Date.now() + durationMin * 60 * 1000 : null;
      await db.ref(`users/${targetUid}`).update({
        banned: true,
        ban_reason: sanitize(req.body?.reason || "moderation"),
        banned_until: until
      });
      await writeAudit(uid, "mod_ban", targetUid, String(durationMin));
      return json(res, 200, { ok: true });
    }

    const modUnbanPath = path.match(/^\/mod\/users\/([^/]+)\/unban$/);
    if (modUnbanPath && req.method === "POST") {
      if (!isModerator(me) && !hasPermission(me, "ban_temp")) return json(res, 403, { error: "Accès refusé" });
      const targetUid = await resolveUid(modUnbanPath[1]);
      await db.ref(`users/${targetUid}`).update({ banned: false, ban_reason: "", banned_until: null });
      await writeAudit(uid, "mod_unban", targetUid);
      return json(res, 200, { ok: true });
    }

    const announcePath = (path === "/admin/announce" || path === "/mod/announce") && req.method === "POST";
    if (announcePath) {
      if (!isModerator(me) && !hasPermission(me, "announce")) return json(res, 403, { error: "Accès refusé" });
      const message = sanitize(req.body?.message || "");
      if (!message) return json(res, 400, { error: "Message requis" });
      await db.ref("announcements").push({
        message,
        from: me.display_name || "Moderation",
        by: uid,
        created_at: Date.now()
      });
      await writeAudit(uid, "announce", "", message);
      return json(res, 200, { ok: true });
    }

    if (path === "/mod/stats" && req.method === "GET") {
      if (!isModerator(me)) return json(res, 403, { error: "Accès refusé" });
      const users = await listUsers();
      return json(res, 200, {
        users: users.length,
        online: users.filter((u) => u.online).length,
        banned: users.filter((u) => u.banned).length
      });
    }

    if ((path === "/mod/users" || path === "/mod/users/list") && req.method === "GET") {
      if (!isModerator(me)) return json(res, 403, { error: "Accès refusé" });
      const users = await listUsers();
      return json(res, 200, users.map((u) => ({
        id: toLegacyNumericId(u),
        uid: u.uid,
        display_name: u.display_name || "Utilisateur",
        login: u.email || "",
        role: u.role || "user",
        online: !!u.online,
        banned: !!u.banned,
        banned_until: u.banned_until || null
      })));
    }

    const adminDisplayNamePath = path.match(/^\/admin\/users\/([^/]+)\/display-name$/);
    if (adminDisplayNamePath && req.method === "PUT") {
      if (!isAdmin(me)) return json(res, 403, { error: "Accès refusé" });
      const targetUid = await resolveUid(adminDisplayNamePath[1]);
      const displayName = sanitize(req.body?.display_name || "");
      await db.ref(`users/${targetUid}/display_name`).set(displayName || "Utilisateur");
      await writeAudit(uid, "admin_rename", targetUid, displayName);
      return json(res, 200, { ok: true });
    }

    const adminAvatarPath = path.match(/^\/admin\/users\/([^/]+)\/avatar$/);
    if (adminAvatarPath && req.method === "PUT") {
      if (!isAdmin(me)) return json(res, 403, { error: "Accès refusé" });
      const targetUid = await resolveUid(adminAvatarPath[1]);
      const avatar = String(req.body?.avatar || "");
      await db.ref(`users/${targetUid}/avatar`).set(avatar || null);
      await writeAudit(uid, "admin_avatar", targetUid);
      return json(res, 200, { ok: true });
    }

    const adminUnbanPath = path.match(/^\/admin\/users\/([^/]+)\/unban$/);
    if (adminUnbanPath && req.method === "POST") {
      if (!isAdmin(me)) return json(res, 403, { error: "Accès refusé" });
      const targetUid = await resolveUid(adminUnbanPath[1]);
      await db.ref(`users/${targetUid}`).update({ banned: false, ban_reason: "", banned_until: null });
      await writeAudit(uid, "admin_unban", targetUid);
      return json(res, 200, { ok: true });
    }

    const adminBanPath = path.match(/^\/admin\/users\/([^/]+)\/ban$/);
    if (adminBanPath && req.method === "POST") {
      if (!isAdmin(me)) return json(res, 403, { error: "Accès refusé" });
      const targetUid = await resolveUid(adminBanPath[1]);
      const reason = sanitize(req.body?.reason || "moderation");
      const duration = Number(req.body?.duration || 0);
      const until = duration > 0 ? Date.now() + duration * 60 * 1000 : null;
      await db.ref(`users/${targetUid}`).update({ banned: true, ban_reason: reason, banned_until: until });
      await writeAudit(uid, "admin_ban", targetUid, reason);
      return json(res, 200, { ok: true });
    }

    const adminKickPath = path.match(/^\/admin\/users\/([^/]+)\/kick$/);
    if (adminKickPath && req.method === "POST") {
      if (!isAdmin(me)) return json(res, 403, { error: "Accès refusé" });
      const targetUid = await resolveUid(adminKickPath[1]);
      await db.ref(`users/${targetUid}`).update({ online: false, last_seen: Date.now() });
      await writeAudit(uid, "admin_kick", targetUid, sanitize(req.body?.reason || ""));
      return json(res, 200, { ok: true, wasOnline: true });
    }

    const adminDeleteUserPath = path.match(/^\/admin\/users\/([^/]+)$/);
    if (adminDeleteUserPath && req.method === "DELETE") {
      if (!isAdmin(me)) return json(res, 403, { error: "Accès refusé" });
      const targetUid = await resolveUid(adminDeleteUserPath[1]);
      await db.ref(`users/${targetUid}`).remove();
      await writeAudit(uid, "admin_delete_user", targetUid);
      return json(res, 200, { ok: true });
    }

    const adminResetPath = path.match(/^\/admin\/users\/([^/]+)\/reset-password$/);
    if (adminResetPath && req.method === "POST") {
      if (!isAdmin(me)) return json(res, 403, { error: "Accès refusé" });
      const targetUid = await resolveUid(adminResetPath[1]);
      await writeAudit(uid, "admin_reset_password", targetUid);
      return json(res, 200, { ok: true });
    }

    if (path === "/admin/audit" && req.method === "GET") {
      if (!isAdmin(me)) return json(res, 403, { error: "Accès refusé" });
      const snap = await db.ref("audit").limitToLast(400).get();
      const logs = [];
      snap.forEach((n) => logs.push({ id: n.key, ...n.val() }));
      logs.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
      return json(res, 200, logs);
    }

    const adminConvPath = path.match(/^\/admin\/conversations\/([^/]+)\/([^/]+)$/);
    if (adminConvPath && req.method === "GET") {
      if (!isAdmin(me)) return json(res, 403, { error: "Accès refusé" });
      const u1 = await resolveUid(adminConvPath[1]);
      const u2 = await resolveUid(adminConvPath[2]);
      const msgs = await listDmMessagesBetween(u1, u2, 500);
      return json(res, 200, msgs);
    }

    const adminMessagePath = path.match(/^\/admin\/messages\/([^/]+)$/);
    if (adminMessagePath && req.method === "PUT") {
      if (!isAdmin(me)) return json(res, 403, { error: "Accès refusé" });
      const messageId = adminMessagePath[1];
      const content = String(req.body?.content || "");
      if (!content) return json(res, 400, { error: "Contenu requis" });
      const dmRoot = await db.ref("dm").get();
      let updated = false;
      dmRoot.forEach((roomNode) => {
        roomNode.child("messages").forEach((msgNode) => {
          if (msgNode.key === messageId) {
            db.ref(`dm/${roomNode.key}/messages/${messageId}`).update({ content, edited: true });
            updated = true;
          }
        });
      });
      return updated ? json(res, 200, { ok: true }) : json(res, 404, { error: "Message introuvable" });
    }
    if (adminMessagePath && req.method === "DELETE") {
      if (!isAdmin(me)) return json(res, 403, { error: "Accès refusé" });
      const messageId = adminMessagePath[1];
      const dmRoot = await db.ref("dm").get();
      let deleted = false;
      dmRoot.forEach((roomNode) => {
        roomNode.child("messages").forEach((msgNode) => {
          if (msgNode.key === messageId) {
            db.ref(`dm/${roomNode.key}/messages/${messageId}`).update({ deleted: true, content: "[Message supprimé]" });
            deleted = true;
          }
        });
      });
      return deleted ? json(res, 200, { ok: true }) : json(res, 404, { error: "Message introuvable" });
    }

    if (path === "/admin/groups" && req.method === "GET") {
      if (!isAdmin(me)) return json(res, 403, { error: "Accès refusé" });
      const groupsSnap = await db.ref("groups").get();
      const groups = [];
      groupsSnap.forEach((g) => groups.push({ id: g.key, ...g.val() }));
      return json(res, 200, groups);
    }

    const adminGroupUpdatePath = path.match(/^\/admin\/groups\/([^/]+)$/);
    if (adminGroupUpdatePath && req.method === "PUT") {
      if (!isAdmin(me)) return json(res, 403, { error: "Accès refusé" });
      const gid = adminGroupUpdatePath[1];
      const name = sanitize(req.body?.name || "");
      if (name) await db.ref(`groups/${gid}/name`).set(name);
      return json(res, 200, { ok: true });
    }
    if (adminGroupUpdatePath && req.method === "DELETE") {
      if (!isAdmin(me)) return json(res, 403, { error: "Accès refusé" });
      const gid = adminGroupUpdatePath[1];
      await db.ref(`groups/${gid}`).remove();
      await db.ref(`groupMembers/${gid}`).remove();
      await db.ref(`groupMessages/${gid}`).remove();
      return json(res, 200, { ok: true });
    }

    const adminGroupMembersPath = path.match(/^\/admin\/groups\/([^/]+)\/members$/);
    if (adminGroupMembersPath && req.method === "GET") {
      if (!isAdmin(me)) return json(res, 403, { error: "Accès refusé" });
      const gid = adminGroupMembersPath[1];
      const membersSnap = await db.ref(`groupMembers/${gid}`).get();
      const users = await listUsers();
      const byUid = new Map(users.map((u) => [u.uid, u]));
      const out = [];
      membersSnap.forEach((m) => {
        const u = byUid.get(m.key);
        if (u) out.push({ id: u.uid, display_name: u.display_name || "Utilisateur", online: !!u.online, role: u.role || "user" });
      });
      return json(res, 200, out);
    }
    if (adminGroupMembersPath && req.method === "POST") {
      if (!isAdmin(me)) return json(res, 403, { error: "Accès refusé" });
      const gid = adminGroupMembersPath[1];
      const targetUid = await resolveUid(String(req.body?.userId || ""));
      if (!targetUid) return json(res, 400, { error: "userId requis" });
      await db.ref(`groupMembers/${gid}/${targetUid}`).set({ joined_at: Date.now() });
      return json(res, 200, { ok: true });
    }

    const adminGroupMemberDeletePath = path.match(/^\/admin\/groups\/([^/]+)\/members\/([^/]+)$/);
    if (adminGroupMemberDeletePath && req.method === "DELETE") {
      if (!isAdmin(me)) return json(res, 403, { error: "Accès refusé" });
      const gid = adminGroupMemberDeletePath[1];
      const targetUid = await resolveUid(adminGroupMemberDeletePath[2]);
      await db.ref(`groupMembers/${gid}/${targetUid}`).remove();
      return json(res, 200, { ok: true });
    }

    const adminGroupMsgsPath = path.match(/^\/admin\/groups\/([^/]+)\/messages$/);
    if (adminGroupMsgsPath && req.method === "GET") {
      if (!isAdmin(me)) return json(res, 403, { error: "Accès refusé" });
      const gid = adminGroupMsgsPath[1];
      const snap = await db.ref(`groupMessages/${gid}`).limitToLast(500).get();
      const out = [];
      snap.forEach((n) => out.push({ id: n.key, ...n.val() }));
      return json(res, 200, out);
    }

    const adminGroupMsgPath = path.match(/^\/admin\/group-messages\/([^/]+)$/);
    if (adminGroupMsgPath && (req.method === "PUT" || req.method === "DELETE")) {
      if (!isAdmin(me)) return json(res, 403, { error: "Accès refusé" });
      const msgId = adminGroupMsgPath[1];
      const roots = await db.ref("groupMessages").get();
      let changed = false;
      roots.forEach((groupNode) => {
        groupNode.forEach((msgNode) => {
          if (msgNode.key === msgId) {
            if (req.method === "PUT") db.ref(`groupMessages/${groupNode.key}/${msgId}`).update({ content: String(req.body?.content || ""), edited: true });
            else db.ref(`groupMessages/${groupNode.key}/${msgId}`).update({ deleted: true, content: "[Message supprimé]" });
            changed = true;
          }
        });
      });
      return changed ? json(res, 200, { ok: true }) : json(res, 404, { error: "Message introuvable" });
    }

    const modKickPath = path.match(/^\/mod\/users\/([^/]+)\/kick$/);
    if (modKickPath && req.method === "POST") {
      if (!isModerator(me) && !hasPermission(me, "kick")) return json(res, 403, { error: "Accès refusé" });
      const targetUid = await resolveUid(modKickPath[1]);
      await db.ref(`users/${targetUid}`).update({ online: false, last_seen: Date.now() });
      return json(res, 200, { ok: true, wasOnline: true });
    }

    const modBanPermPath = path.match(/^\/mod\/users\/([^/]+)\/ban-perm$/);
    if (modBanPermPath && req.method === "POST") {
      if (!isModerator(me) && !hasPermission(me, "ban_perm")) return json(res, 403, { error: "Accès refusé" });
      const targetUid = await resolveUid(modBanPermPath[1]);
      await db.ref(`users/${targetUid}`).update({ banned: true, ban_reason: sanitize(req.body?.reason || "moderation"), banned_until: null });
      return json(res, 200, { ok: true });
    }

    const modRenamePath = path.match(/^\/mod\/users\/([^/]+)\/display-name$/);
    if (modRenamePath && req.method === "PUT") {
      if (!isModerator(me) && !hasPermission(me, "rename_user")) return json(res, 403, { error: "Accès refusé" });
      const targetUid = await resolveUid(modRenamePath[1]);
      await db.ref(`users/${targetUid}/display_name`).set(sanitize(req.body?.display_name || "Utilisateur"));
      return json(res, 200, { ok: true });
    }

    const modResetPath = path.match(/^\/mod\/users\/([^/]+)\/reset-password$/);
    if (modResetPath && req.method === "POST") {
      if (!isModerator(me) && !hasPermission(me, "reset_password")) return json(res, 403, { error: "Accès refusé" });
      const targetUid = await resolveUid(modResetPath[1]);
      await writeAudit(uid, "mod_reset_password", targetUid);
      return json(res, 200, { ok: true });
    }

    const modDeleteUserPath = path.match(/^\/mod\/users\/([^/]+)$/);
    if (modDeleteUserPath && req.method === "DELETE") {
      if (!isModerator(me) && !hasPermission(me, "delete_user")) return json(res, 403, { error: "Accès refusé" });
      const targetUid = await resolveUid(modDeleteUserPath[1]);
      await db.ref(`users/${targetUid}`).remove();
      return json(res, 200, { ok: true });
    }

    const modConvPath = path.match(/^\/mod\/conversations\/([^/]+)\/([^/]+)$/);
    if (modConvPath && req.method === "GET") {
      if (!isModerator(me) && !hasPermission(me, "view_convs")) return json(res, 403, { error: "Accès refusé" });
      const u1 = await resolveUid(modConvPath[1]);
      const u2 = await resolveUid(modConvPath[2]);
      const msgs = await listDmMessagesBetween(u1, u2, 500);
      return json(res, 200, msgs);
    }

    const modMessagePath = path.match(/^\/mod\/messages\/([^/]+)$/);
    if (modMessagePath && (req.method === "PUT" || req.method === "DELETE")) {
      if (!isModerator(me) && !hasPermission(me, req.method === "PUT" ? "edit_msg" : "delete_msg")) return json(res, 403, { error: "Accès refusé" });
      const messageId = modMessagePath[1];
      const dmRoot = await db.ref("dm").get();
      let changed = false;
      dmRoot.forEach((roomNode) => {
        roomNode.child("messages").forEach((msgNode) => {
          if (msgNode.key === messageId) {
            if (req.method === "PUT") db.ref(`dm/${roomNode.key}/messages/${messageId}`).update({ content: String(req.body?.content || ""), edited: true });
            else db.ref(`dm/${roomNode.key}/messages/${messageId}`).update({ deleted: true, content: "[Message supprimé]" });
            changed = true;
          }
        });
      });
      return changed ? json(res, 200, { ok: true }) : json(res, 404, { error: "Message introuvable" });
    }

    if (path.startsWith("/messages/") && req.method === "POST") {
      const payload = req.body || {};
      const receiverId = payload.receiverId;
      const content = String(payload.content || "");
      if (!receiverId) return json(res, 400, { error: "receiverId requis" });
      if (!content) return json(res, 400, { error: "Message vide" });
      if (content.length > MAX_MESSAGE_LENGTH && !content.startsWith("data:image/")) return json(res, 400, { error: "Message trop long" });
      if (content.startsWith("data:image/") && content.length > MAX_INLINE_IMAGE_SIZE) return json(res, 400, { error: "Image trop lourde" });
      const room = dmRoomId(uid, receiverId);
      const msgRef = db.ref(`dm/${room}/messages`).push();
      await msgRef.set({
        sender_id: uid,
        receiver_id: receiverId,
        sender_name: me.display_name || "Utilisateur",
        content,
        read: false,
        deleted: false,
        edited: false,
        created_at: Date.now(),
        reply_to: payload.replyTo || null
      });
      await db.ref(`users/${uid}/msg_count`).transaction((x) => (x || 0) + 1);
      return json(res, 201, { id: msgRef.key });
    }

    logger.info("Unhandled route", { path, method: req.method });
    return json(res, 404, { error: "Route Firebase non implementee", path, method: req.method });
  } catch (err) {
    logger.error("API error", err);
    return json(res, 500, { error: "Erreur serveur Firebase", detail: String(err?.message || err) });
  }
});
