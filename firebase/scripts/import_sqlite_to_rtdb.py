import argparse
import json
import os
import sqlite3
import time
from pathlib import Path


def normalize_email(login: str, user_id: int) -> str:
    raw = (login or "").strip().lower()
    if "@" in raw:
        return raw
    safe = "".join(c for c in raw if c.isalnum() or c in "._-")[:24] or f"user{user_id}"
    return f"{safe}@xygochat.app"


def uid_for_legacy(user_id: int) -> str:
    return f"legacy_{user_id}"


def dm_room(uid_a: str, uid_b: str) -> str:
    return "__".join(sorted([str(uid_a), str(uid_b)]))


def fetch_all(cur, table: str):
    cur.execute(f"SELECT * FROM {table}")
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, row)) for row in cur.fetchall()]


def main():
    parser = argparse.ArgumentParser(description="Import SQLite XyGo -> Firebase RTDB payload")
    parser.add_argument("--db", default=str(Path(__file__).resolve().parents[2] / "server" / "messenger.db"))
    parser.add_argument("--dry-run", action="store_true", default=False)
    parser.add_argument("--out", default=str(Path(__file__).resolve().parents[1] / "migration-payload.json"))
    args = parser.parse_args()

    db_path = Path(args.db).resolve()
    if not db_path.exists():
        raise FileNotFoundError(f"SQLite introuvable: {db_path}")

    conn = sqlite3.connect(str(db_path))
    cur = conn.cursor()

    users = fetch_all(cur, "users")
    messages = fetch_all(cur, "messages")
    groups = fetch_all(cur, "groups")
    group_members = fetch_all(cur, "group_members")
    group_messages = fetch_all(cur, "group_messages")
    notes = fetch_all(cur, "notes")
    reactions = fetch_all(cur, "reactions")
    audit_log = fetch_all(cur, "audit_log")
    pinned_chats = fetch_all(cur, "pinned_chats")

    id_to_uid = {str(u["id"]): uid_for_legacy(u["id"]) for u in users}
    payload = {
        "users": {},
        "dm": {},
        "groups": {},
        "groupMembers": {},
        "groupMessages": {},
        "notes": {},
        "reactions": {},
        "audit": [],
        "pins": {}
    }

    for u in users:
        uid = id_to_uid[str(u["id"])]
        permissions = []
        restrictions = []
        try:
            permissions = json.loads(u.get("permissions") or "[]")
        except Exception:
            permissions = []
        try:
            restrictions = json.loads(u.get("restrictions") or "[]")
        except Exception:
            restrictions = []
        payload["users"][uid] = {
            "uid": uid,
            "legacy_id": u["id"],
            "email": normalize_email(u.get("login"), u["id"]),
            "login": u.get("login"),
            "display_name": u.get("display_name") or "Utilisateur",
            "bio": u.get("bio") or "",
            "avatar": u.get("avatar"),
            "role": u.get("role") or "user",
            "permissions": permissions,
            "restrictions": restrictions,
            "banned": bool(u.get("banned")),
            "ban_reason": u.get("ban_reason") or "",
            "banned_until": u.get("banned_until"),
            "grade": u.get("grade"),
            "online": bool(u.get("online")),
            "last_seen": u.get("last_seen"),
            "created_at": u.get("created_at"),
            "msg_count": 0,
        }

    for m in messages:
        if m.get("group_id"):
            continue
        sender_uid = id_to_uid.get(str(m.get("sender_id")))
        receiver_uid = id_to_uid.get(str(m.get("receiver_id")))
        if not sender_uid or not receiver_uid:
            continue
        room = dm_room(sender_uid, receiver_uid)
        payload["dm"].setdefault(room, {"messages": []})
        payload["dm"][room]["messages"].append({
            "legacy_id": m.get("id"),
            "sender_id": sender_uid,
            "receiver_id": receiver_uid,
            "content": m.get("content") or "",
            "reply_to": m.get("reply_to"),
            "read": bool(m.get("read")),
            "deleted": bool(m.get("deleted")),
            "edited": bool(m.get("edited")),
            "created_at": m.get("created_at"),
        })
        payload["users"][sender_uid]["msg_count"] += 1

    for g in groups:
        gid = str(g["id"])
        payload["groups"][gid] = {
            "id": gid,
            "name": g.get("name"),
            "avatar": g.get("avatar"),
            "owner_id": id_to_uid.get(str(g.get("owner_id")), "legacy_0"),
            "is_public": 1 if g.get("is_public") else 0,
            "created_at": g.get("created_at"),
        }

    for gm in group_members:
        gid = str(gm.get("group_id"))
        uid = id_to_uid.get(str(gm.get("user_id")))
        if not uid:
            continue
        payload["groupMembers"].setdefault(gid, {})
        payload["groupMembers"][gid][uid] = {"joined_at": gm.get("joined_at")}

    for gm in group_messages:
        gid = str(gm.get("group_id"))
        sender_uid = id_to_uid.get(str(gm.get("sender_id")))
        if not sender_uid:
            continue
        payload["groupMessages"].setdefault(gid, [])
        payload["groupMessages"][gid].append({
            "legacy_id": gm.get("id"),
            "groupId": gid,
            "sender_id": sender_uid,
            "content": gm.get("content") or "",
            "reply_to": gm.get("reply_to"),
            "deleted": bool(gm.get("deleted")),
            "edited": bool(gm.get("edited")),
            "created_at": gm.get("created_at"),
        })

    for n in notes:
        uid = id_to_uid.get(str(n.get("user_id")))
        if not uid:
            continue
        payload["notes"].setdefault(uid, [])
        payload["notes"][uid].append({
            "legacy_id": n.get("id"),
            "content": n.get("content") or "",
            "type": n.get("type") or "text",
            "created_at": n.get("created_at"),
            "expires_at": n.get("expires_at"),
        })

    for r in reactions:
        msg_id = str(r.get("message_id"))
        uid = id_to_uid.get(str(r.get("user_id")))
        if not uid:
            continue
        payload["reactions"].setdefault(msg_id, {})
        payload["reactions"][msg_id].setdefault(uid, {})
        payload["reactions"][msg_id][uid][r.get("emoji")] = {"created_at": r.get("created_at")}

    for a in audit_log:
        payload["audit"].append({
            "actor_uid": id_to_uid.get(str(a.get("admin_id")), "legacy_0"),
            "action": a.get("action") or "",
            "target": a.get("target") or "",
            "detail": a.get("detail") or "",
            "created_at": a.get("created_at"),
        })

    for p in pinned_chats:
        uid = id_to_uid.get(str(p.get("user_id")))
        target_uid = id_to_uid.get(str(p.get("target_id")))
        if not uid or not target_uid:
            continue
        key = f"{p.get('target_type') or 'user'}:{target_uid}"
        payload["pins"].setdefault(uid, {})
        payload["pins"][uid][key] = {
            "target_id": target_uid,
            "target_type": p.get("target_type") or "user",
            "pinned_at": p.get("pinned_at"),
        }

    out_path = Path(args.out).resolve()
    out_path.write_text(json.dumps(payload, ensure_ascii=True, indent=2), encoding="utf-8")

    print("=== Migration payload generated ===")
    print("dry_run:", args.dry_run)
    print("sqlite:", str(db_path))
    print("out:", str(out_path))
    print("counts:", {
        "users": len(users),
        "messages": len(messages),
        "groups": len(groups),
        "group_members": len(group_members),
        "group_messages": len(group_messages),
        "notes": len(notes),
        "reactions": len(reactions),
        "audit_log": len(audit_log),
        "pinned_chats": len(pinned_chats),
    })
    if args.dry_run:
        print("Dry-run ok:", int(time.time()))


if __name__ == "__main__":
    main()
