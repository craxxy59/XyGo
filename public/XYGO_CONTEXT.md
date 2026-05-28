**XYGO MESSENGER — CONTEXTE COMPLET DU PROJET**  
**VUE D'ENSEMBLE**  
Réseau social de messagerie privée appelé **XyGo**, entièrement fonctionnel et hébergé en production.  
![](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAnEAAAACCAYAAAA3pIp+AAAABmJLR0QA/wD/AP+gvaeTAAAACXBIWXMAAA7EAAAOxAGVKw4bAAAANUlEQVR4nO3OMQ2AABAAsSPBCj7fFwtCmJHAjAU2QtIq6DIzW7UHAMBfnGt1V8fHEQAA3rsexOkF3va0dq8AAAAASUVORK5CYII=)  
**INFRASTRUCTURE**  
**Serveur Backend**  
- **Machine** : NAS Debian, user craxxy5909, IP locale 192.168.1.22  
- **IP publique** : 86.192.161.55  
- **Domaine HTTPS** : https://craxxy5909-msg.duckdns.org (Let's Encrypt via DuckDNS)  
- **Port applicatif** : 3000 (Node.js) → proxifié par Nginx sur le port 443  
- **Process manager** : PM2, app nommée nexus-messenger  
- **Chemin app** : /home/craxxy5909/social-app/  
- **Base de données** : SQLite (messenger.db) via better-sqlite3  
- **Fichier env** : /home/craxxy5909/social-app/.env  
**Frontend**  
- **Hébergé sur** : Netlify — URL : https://xygo.netlify.app  
- **Type** : SPA HTML/CSS/JS pur (pas de framework), un seul fichier index.html  
- **Dossier** : frontend/ à glisser-déposer sur Netlify pour déployer  
**Nginx config**  
server {  
    listen 443 ssl;  
     server_name craxxy5909-msg.duckdns.org;  
     ssl_certificate /etc/letsencrypt/live/craxxy5909-msg.duckdns.org/fullchain.pem;  
     ssl_certificate_key /etc/letsencrypt/live/craxxy5909-msg.duckdns.org/privkey.pem;  
     location /socket.io/ {  
         proxy_pass http://127.0.0.1:3000;  
         proxy_http_version 1.1;  
         proxy_set_header Upgrade $http_upgrade;  
         proxy_set_header Connection "upgrade";  
         proxy_set_header X-Forwarded-Proto $scheme;  
         proxy_read_timeout 86400s;  
     }  
     location / {  
         proxy_pass http://127.0.0.1:3000;  
         proxy_http_version 1.1;  
         proxy_set_header Upgrade $http_upgrade;  
         proxy_set_header Connection "upgrade";  
         proxy_set_header X-Forwarded-Proto $scheme;  
     }  
 }  
   
**Fichier .env (sur le serveur)**  
NODE_ENV=production  
 SESSION_SECRET=nexus_craxxy_secret_2024!  
 ALLOWED_ORIGINS=https://xygo.netlify.app  
 VAPID_PUBLIC=BJV3UPR32yYCL-Z4fHKct2o6k5UzS8UmHOz-MSmRoDj9aRxR3j0VrLBgxTnaWHjGlWZ1Ftxoi2Qkqz1gZNC4rkk  
 VAPID_PRIVATE=_kxYWpBk0S-LwcCbyVMTScIDxVz1xVaC3uzf065Srew  
   
**Commandes de gestion PM2**  
pm2 restart nexus-messenger  
 pm2 logs nexus-messenger --lines 20 --nostream  
 pm2 delete nexus-messenger && pm2 start server.js --name nexus-messenger && pm2 save  
   
**Déploiement**  
# Backend  
 scp server.js craxxy5909@192.168.1.22:~/social-app/server.js  
 ssh craxxy5909@192.168.1.22 "cd ~/social-app && pm2 restart nexus-messenger"  
   
 # Frontend : dézipper frontend-netlify.zip → glisser le dossier frontend/ sur xygo.netlify.app  
   
![](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAnEAAAACCAYAAAA3pIp+AAAABmJLR0QA/wD/AP+gvaeTAAAACXBIWXMAAA7EAAAOxAGVKw4bAAAANElEQVR4nO3OQQmAABRAsaeILbwZ9Fewo0Gs4E2ELcGWmTmqKwAA/uLeqr06v54AAPDa+gAthwNEfGhnhAAAAABJRU5ErkJggg==)  
**STACK TECHNIQUE**  
**Backend (server.js — 738 lignes)**  
- **Node.js** +  **Express 4**  
- **Socket.io 4** (temps réel)  
- **better-sqlite3** (base de données SQLite)  
- **bcrypt** (hash mots de passe)  
- **cors** (cross-origin Netlify → DuckDNS)  
- **express-session** + système de  **tokens Bearer** maison (localStorage) pour Safari iOS  
- **web-push** (notifications push Web)  
- **dotenv**  
**Frontend (index.html — 2145 lignes)**  
- HTML/CSS/JS pur, **zéro framework**  
- **Socket.io client** (CDN)  
- Polices Google : **Space Mono** +  **Syne**  
- PWA (manifest.json + sw.js)  
![](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAnEAAAACCAYAAAA3pIp+AAAABmJLR0QA/wD/AP+gvaeTAAAACXBIWXMAAA7EAAAOxAGVKw4bAAAANklEQVR4nO3OQQmAABRAsSeYxZw/lieLGMACBrCCNxG2BFtmZquOAAD4i3Ot7mr/egIAwGvXA6fGBdgoVMwYAAAAAElFTkSuQmCC)  
**BASE DE DONNÉES SQLite**  
**Table **users  
| | | |  
|-|-|-|  
| **Colonne** | **Type** | **Description** |   
| id | INTEGER PK | Auto-increment |   
| login | TEXT UNIQUE | Identifiant de connexion (fixe, jamais affiché) |   
| display_name | TEXT UNIQUE | Pseudo affiché (modifiable) |   
| password | TEXT | Hash bcrypt |   
| bio | TEXT | Bio courte (max 100 chars) |   
| avatar | TEXT | Photo de profil en base64 JPEG |   
| role | TEXT | 'user', 'moderator', 'admin' |   
| grade | TEXT | Grade personnalisé affiché (nullable) |   
| banned | INTEGER | 0/1 |   
| ban_reason | TEXT | Raison du ban |   
| banned_until | TEXT | ISO date fin de ban temporaire (null = permanent) |   
| online | INTEGER | 0/1 (mis à jour par Socket.io) |   
| created_at | TEXT | datetime SQLite |   
   
**Table **messages  
| | | |  
|-|-|-|  
| **Colonne** | **Type** | **Description** |   
| id | INTEGER PK |   |   
| sender_id | INTEGER FK |   |   
| receiver_id | INTEGER FK |   |   
| content | TEXT | Contenu |   
| reply_to | INTEGER | ID du message auquel on répond (nullable) |   
| read | INTEGER | 0/1 |   
| deleted | INTEGER | Soft delete |   
| edited | INTEGER | 0/1 |   
| created_at | TEXT |   |   
   
**Table **reactions  
| | | |  
|-|-|-|  
| **Colonne** | **Type** | **Description** |   
| id | INTEGER PK |   |   
| message_id | INTEGER FK |   |   
| user_id | INTEGER FK |   |   
| emoji | TEXT | Emoji (ex: "❤️") |   
| UNIQUE |   | (message_id, user_id, emoji) — toggle |   
   
**Table **tokens  
| | | |  
|-|-|-|  
| **Colonne** | **Type** | **Description** |   
| id | INTEGER PK |   |   
| user_id | INTEGER FK |   |   
| token | TEXT UNIQUE | Token Bearer 64 chars hex |   
| expires_at | TEXT | Expiration 7 jours |   
   
**Table **push_subscriptions  
| | | |  
|-|-|-|  
| **Colonne** | **Type** | **Description** |   
| id | INTEGER PK |   |   
| user_id | INTEGER FK |   |   
| endpoint | TEXT UNIQUE | URL push service |   
| p256dh | TEXT | Clé publique client |   
| auth | TEXT | Auth secret |   
   
**Table **audit_log  
| | | |  
|-|-|-|  
| **Colonne** | **Type** | **Description** |   
| id | INTEGER PK |   |   
| admin_id | INTEGER FK | Qui a fait l'action |   
| action | TEXT | BAN, UNBAN, BAN_TEMP, KICK, DELETE_USER, DELETE_MSG, EDIT_MSG, RESET_PASSWORD, ANNOUNCE, RENAME, PROMOTE, DEMOTE, SET_GRADE |   
| target | TEXT | Nom de la cible |   
| detail | TEXT | Détails |   
| created_at | TEXT |   |   
   
![](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAnEAAAACCAYAAAA3pIp+AAAABmJLR0QA/wD/AP+gvaeTAAAACXBIWXMAAA7EAAAOxAGVKw4bAAAANUlEQVR4nO3OMQ2AABAAsSNhwgJOUPcjIpnRgQU2QtIq6DIze3UGAMBf3Gu1VcfXEwAAXrseaJEEL8XMiYMAAAAASUVORK5CYII=)  
**ROUTES API**  
**Auth (public)**  
POST /api/register    { login, display_name, password } → { token, user }  
 POST /api/login       { login, password }               → { token, user }  
 POST /api/logout      (auth requis)  
 GET  /api/auth/verify (Bearer token header)             → user info  
 GET  /api/me          (auth requis)  
   
**Utilisateurs (auth requis)**  
GET  /api/users                    Liste tous les users sauf soi  
 PUT  /api/users/display-name       { display_name }  
 PUT  /api/users/bio                { bio }  
 PUT  /api/users/avatar             { avatar } (base64 JPEG, max ~600Ko)  
 GET  /api/users/stats              { messages, reactions, days }  
   
**Messages (auth requis)**  
GET    /api/messages/:userId       Historique avec un user  
 DELETE /api/messages/:id           Supprimer son propre message  
 PUT    /api/messages/:id           Modifier son propre message { content }  
 POST   /api/messages/:id/react     Réagir { emoji } (toggle)  
   
**Push notifications**  
GET  /api/push/vapid-key           { publicKey }  
 POST /api/push/subscribe           { endpoint, keys: { p256dh, auth } }  
 POST /api/push/unsubscribe         { endpoint }  
   
**Admin (role=admin uniquement)**  
GET  /api/admin/stats  
 GET  /api/admin/users  
 GET  /api/admin/audit  
 GET  /api/admin/conversations/:id1/:id2  
 POST /api/admin/announce           { message }  
 PUT  /api/admin/users/:id/display-name   { display_name }  
 PUT  /api/admin/users/:id/grade          { grade }  
 POST /api/admin/users/:id/role           { role: 'admin'|'moderator'|'user' }  
 POST /api/admin/users/:id/ban            { reason, duration (minutes, 0=permanent) }  
 POST /api/admin/users/:id/unban  
 POST /api/admin/users/:id/kick           { reason }  
 POST /api/admin/users/:id/reset-password { newPassword }  
 DELETE /api/admin/users/:id  
 DELETE /api/admin/messages/:id  
 PUT    /api/admin/messages/:id           { content }  
   
**Modérateur (role=moderator ou admin)**  
GET  /api/mod/stats  
 GET  /api/mod/users  
 POST /api/mod/users/:id/kick    { reason }  
 POST /api/mod/users/:id/ban     { reason, duration } (max 24h)  
 PUT  /api/mod/messages/:id      { content }  
 DELETE /api/mod/messages/:id  
   
![](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAnEAAAACCAYAAAA3pIp+AAAABmJLR0QA/wD/AP+gvaeTAAAACXBIWXMAAA7EAAAOxAGVKw4bAAAANklEQVR4nO3OUQmAABBAsSeYxZyXSzCJASxgACv4J8KWYMvMbNURAAB/ca7VXe1fTwAAeO16AKe+BdmJqrPdAAAAAElFTkSuQmCC)  
**EVENTS SOCKET.IO**  
**Émis par le serveur → clients**  
user:status         { userId, online }          Connexion/déconnexion  
 user:name_changed   { userId, display_name }    Changement de pseudo  
 user:avatar_changed { userId, avatar }          Changement de photo  
 user:role_changed   { userId, role }            Changement de rôle  
 user:grade_changed  { userId, grade }           Changement de grade  
 message:new         { ...msg, reactions:[] }    Nouveau message  
 message:edited      { messageId, content }      Message modifié  
 message:deleted     { messageId }               Message supprimé  
 message:notify      { from, fromId }            Notification in-app  
 reaction:update     { messageId, reactions }    Réaction ajoutée/retirée  
 admin:user_update   { userId, banned }          Statut ban changé  
 admin:user_deleted  { userId }                  User supprimé  
 admin:announce      { message, from }           Annonce globale  
 force:logout        { reason }                  Déconnexion forcée (ban)  
 force:kick          { reason }                  Kick (reconnexion après 3s)  
   
**Émis par client → serveur**  
message:send { receiverId, content, replyTo? }  
   
![](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAnEAAAACCAYAAAA3pIp+AAAABmJLR0QA/wD/AP+gvaeTAAAACXBIWXMAAA7EAAAOxAGVKw4bAAAANklEQVR4nO3OMQ2AABAAsSNhYMEBIpD4ArCJDyywEZJWQZeZOaorAAD+4l6rrTq/ngAA8Nr+AEqmA1hl45m5AAAAAElFTkSuQmCC)  
**AUTHENTIFICATION**  
Système **double** pour compatibilité Safari iOS (qui bloque les cookies cross-origin) :  
1. **Tokens Bearer** (principal) : après login/register, un token 64 chars hex est stocké dans localStorage sous la clé xygo_auth_token. Chaque requête envoie Authorization: Bearer <token> dans les headers. Token valide 7 jours.  
2. **Cookies session** (fallback) : express-session avec sameSite: 'none', secure: true pour Chrome/Firefox.  
Le requireAuth middleware accepte les deux méthodes.  
![](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAnEAAAACCAYAAAA3pIp+AAAABmJLR0QA/wD/AP+gvaeTAAAACXBIWXMAAA7EAAAOxAGVKw4bAAAANklEQVR4nO3OQQmAABRAsScYxpg/h5VMYARvRrCCNxG2BFtmZquOAAD4i3Ot7mr/egIAwGvXA224BcUMk6pDAAAAAElFTkSuQmCC)  
**SYSTÈME DE RÔLES**  
| | | |  
|-|-|-|  
| **Rôle** | **Valeur BDD** | **Accès** |   
| Utilisateur | 'user' | Messagerie, modifier son profil, réagir |   
| Modérateur | 'moderator' | + Kick, ban temp (max 24h), supprimer/modifier messages |   
| Admin | 'admin' | Accès complet |   
   
**Super admin fixe** : login Craxxy5909 — rôle forcé à admin à chaque démarrage du serveur, impossible de bannir/supprimer/rétrograder.  
![](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAnEAAAACCAYAAAA3pIp+AAAABmJLR0QA/wD/AP+gvaeTAAAACXBIWXMAAA7EAAAOxAGVKw4bAAAANklEQVR4nO3OMQ2AABAAsSNBCkJfFSqwwIgHRiywEZJWQZeZ2ao9AAD+4lyruzq+ngAA8Nr1AOH8BeZxN/IIAAAAAElFTkSuQmCC)  
**FONCTIONNALITÉS FRONTEND**  
**Interface générale**  
- **Thème light/dark** switchable (bouton 🌙/☀️ dans le header), sauvegardé en localStorage  
- **Couleurs XyGo** : cyan #00d4ff + violet #c040ff, fond sombre #05050d  
- **Mobile first** : sur < 640px, navigation par glissement (liste ↔ chat), bouton ‹ retour  
**Messagerie**  
- Liste des membres avec statut en ligne/hors ligne en temps réel  
- Avatars personnalisés + indicateur online  
- Grades et badges affichés sous les pseudos  
- Messages avec heure (fuseau Europe/Paris)  
- **Répondre à un message** (style WhatsApp) : appui long sur mobile, hover sur desktop → barre de réponse + citation dans la bulle  
- **Modifier/Supprimer** ses messages : hover → menu contextuel, appui long sur mobile  
- **Réactions emoji** : 10 emojis (❤️ 😂 😮 😢 😡 👍 👎 🔥 🎉 💯), toggle, compteur en temps réel  
- Messages non lus : badge dans la liste + titre de l'onglet (N) XyGo clignotant  
- **Notifications in-app** : popup en haut de l'écran avec aperçu du message  
- **Son de notification** : bip généré par Web Audio API  
- **Push notifications** Web (service worker) : fonctionne sur PC/Chrome, partiellement sur mobile Android (problème FCM réseau)  
**Profil utilisateur**  
- Bouton "Mon profil" en bas de la sidebar  
- Modal profil avec : photo de profil (upload + compression canvas), pseudo, bio  
- Stats : nombre de messages, jours d'ancienneté, réactions reçues  
- Grade affiché si attribué par un admin  
**PWA (Progressive Web App)**  
- Installable sur écran d'accueil Android (Chrome) et iPhone (Safari)  
- Icônes XyGo générées : 72, 96, 128, 144, 152, 192, 384, 512px  
- Service worker avec cache offline (version xygo-v5)  
- Bannière d'installation automatique après 8 secondes  
- Instructions iOS affichées après connexion si pas installé  
**Panneau Admin (👑 Craxxy5909 + admins promus)**  
Onglets :  
- **📊 Stats** : membres total, en ligne, bannis, messages, aujourd'hui, nouveaux 7j  
- **👥 Membres** : liste complète avec actions :  
- ✏️ Renommer le pseudo  
- ✦ Grade (8 prédéfinis + personnalisé)  
- 👑 Promouvoir admin / 🛡️ Nommer modérateur / ⬇️ Rétrograder  
- ⊘ Ban permanent + ⏱ Ban temporaire (5min à 24h+)  
- ⚡ Kick  
- 🔑 Réinitialiser mot de passe  
- 🗑️ Supprimer le compte  
- **✉️ Messages** : charger la conversation entre 2 membres, modifier/supprimer  
- **📢 Annonce** : message diffusé à tous les connectés (bannière violette)  
- **📋 Journal d'audit** : historique de toutes les actions admin/mod  
**Panneau Modérateur (🛡️)**  
- Stats simplifiées  
- Liste membres avec : ⚡ Kick, ⏱ Ban temp (max 24h), ✓ Débannir  
![](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAnEAAAACCAYAAAA3pIp+AAAABmJLR0QA/wD/AP+gvaeTAAAACXBIWXMAAA7EAAAOxAGVKw4bAAAANUlEQVR4nO3OsQ1AABRAwSdRaPXGMOCv7WkPK+hEcjfBLTNzVFcAAPzFvVZbdX49AQDgtf0BSpoDXv5TGXgAAAAASUVORK5CYII=)  
**FICHIERS DU PROJET**  
**Sur le serveur (**/home/craxxy5909/social-app/ **)**  
server.js          Backend principal (738 lignes)  
 package.json       Dépendances Node  
 .env               Variables d'environnement (VAPID keys, CORS, etc.)  
 messenger.db       Base de données SQLite (données en production)  
 node_modules/      Dépendances installées  
   
**Frontend (**frontend/ **)**  
index.html         SPA complète (2145 lignes)  
 sw.js              Service worker PWA  
 manifest.json      Manifest PWA  
 netlify.toml       Config Netlify (SPA redirect)  
 logo.png           Logo XyGo (fond noir, X cyan/violet)  
 favicon.png        Favicon 32x32  
 apple-touch-icon.png  180x180 pour iOS  
 icon-72.png ... icon-512.png  Icônes PWA  
   
![](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAnEAAAACCAYAAAA3pIp+AAAABmJLR0QA/wD/AP+gvaeTAAAACXBIWXMAAA7EAAAOxAGVKw4bAAAANUlEQVR4nO3OMQ2AABAAsSPBCUbfEm6YmFDBhAU2QtIq6DIzW7UHAMBfnGt1V8fXEwAAXrse/w8F7pbTa1oAAAAASUVORK5CYII=)  
**PROBLÈMES CONNUS / EN COURS**  
1. **Push notifications Android** : erreur AbortError: Registration failed - push service error sur certains réseaux (FCM de Google bloqué). Fonctionne sur PC Chrome. Clés VAPID correctes, serveur web-push configuré OK.  
2. **Kick/Ban temp depuis l'admin panel** : potentiellement ne déconnecte pas l'utilisateur si connectedUsers Map n'est pas bien peuplée au moment de l'appel (à vérifier avec pm2 logs après une tentative).  
3. **Photo de profil** : upload fonctionne mais la mise à jour en temps réel chez les autres utilisateurs peut avoir un léger délai.  
![](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAnEAAAACCAYAAAA3pIp+AAAABmJLR0QA/wD/AP+gvaeTAAAACXBIWXMAAA7EAAAOxAGVKw4bAAAANElEQVR4nO3OQQmAABRAsad4EjtY9fewnUms4E2ELcGWmTmrKwAA/uLeqrU6vp4AAPDa/gDzWAM6QQXRdAAAAABJRU5ErkJggg==)  
**DÉPENDANCES npm (**package.json **)**  
{  
   "dependencies": {  
     "bcrypt": "^5.1.1",  
     "better-sqlite3": "^9.4.3",  
     "cookie-parser": "^1.4.6",  
     "cors": "^2.8.5",  
     "dotenv": "latest",  
     "express": "^4.18.2",  
     "express-session": "^1.17.3",  
     "socket.io": "^4.6.1",  
     "web-push": "^3.6.7"  
   }  
 }  
   
![](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAnEAAAACCAYAAAA3pIp+AAAABmJLR0QA/wD/AP+gvaeTAAAACXBIWXMAAA7EAAAOxAGVKw4bAAAANUlEQVR4nO3OMQ2AABAAsSNhZscaUpheJwqQgQU2QtIq6DIze3UGAMBf3Gu1VcfXEwAAXrseopcEQ2uoYnwAAAAASUVORK5CYII=)  
**WORKFLOW DE DÉVELOPPEMENT**  
Pour modifier le projet :  
1. Modifier server.js → scp sur le serveur → pm2 restart nexus-messenger  
2. Modifier frontend/index.html → zipper le dossier frontend/ → déposer sur Netlify  
3. Toujours valider la syntaxe JS avant de déployer : node --check server.js  
4. Vérifier les logs après restart : pm2 logs nexus-messenger --lines 10 --nostream  
![](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAnEAAAACCAYAAAA3pIp+AAAABmJLR0QA/wD/AP+gvaeTAAAACXBIWXMAAA7EAAAOxAGVKw4bAAAANUlEQVR4nO3OMQ2AABAAsSPBCj5fFyM6mJHAjAU2QtIq6DIzW7UHAMBfnGt1V8fXEwAAXrsexOEF35f1aEgAAAAASUVORK5CYII=)  
**CLÉS IMPORTANTES À NE PAS PERDRE**  
- **Clé VAPID publique** : BJV3UPR32yYCL-Z4fHKct2o6k5UzS8UmHOz-MSmRoDj9aRxR3j0VrLBgxTnaWHjGlWZ1Ftxoi2Qkqz1gZNC4rkk  
- **Clé VAPID privée** : _kxYWpBk0S-LwcCbyVMTScIDxVz1xVaC3uzf065Srew  
- Ces clés sont dans le .env du serveur et dans le server.js comme fallback.  
- Si on change les clés VAPID, tous les appareils abonnés doivent se ré-abonner.  
![](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAnEAAAACCAYAAAA3pIp+AAAABmJLR0QA/wD/AP+gvaeTAAAACXBIWXMAAA7EAAAOxAGVKw4bAAAANElEQVR4nO3OQQmAABRAsSdYxKY/jbnMIJ7FCt5E2BJsmZmt2gMA4C+Otbqr8+sJAACvXQ85TgYRMv3/cwAAAABJRU5ErkJggg==)  
**COMPTE ADMIN**  
- **Login de connexion** : Craxxy5909 (identifiant, jamais affiché)  
- **Rôle** : forcé à admin à chaque démarrage du serveur (ne peut pas être rétrogradé)  
- Le pseudo affiché (display_name) peut être modifié librement  
   
   
   
   
| | |  
|-|-|  
| **Feature** | **Statut** |   
| Menu contextuel Instagram (appui long / clic droit) | ✅ |   
| Double-tap ❤️ style Instagram | ✅ |   
| Réactions rapides (6) + picker complet (15) | ✅ |   
| Copier texte, répondre, modifier, supprimer | ✅ |   
| Indicateur de frappe | ✅ |   
| Accusés de lecture ✓✓ | ✅ |   
| Envoi d'images 📷 | ✅ |   
| Recherche dans les conversations 🔍 | ✅ |   
| Lightbox images plein écran | ✅ |   
| "Vu il y a X min" hors ligne | ✅ |   
| Indicateur connexion serveur 🟢🔴 | ✅ |   
| **Panneau mod avec onglet Messages** | ✅ **NOUVEAU** |   
| Mod : voir conversations entre 2 users | ✅ **NOUVEAU** |   
| Mod : modifier/supprimer messages | ✅ **NOUVEAU** |   
| Rate limiting (login 30/5min) | ✅ |   
| Sécurité headers + sanitize | ✅ |   
| PWA + Push notifications | ✅ |   
| Thème light/dark |   |   
   
Ajoute :   
| | |  
|-|-|  
| **Fonctionnalité** | **Détail** |   
| 🏠 **Groupe public** | Salon "XyGo Public" accessible à tous |   
| 👥 **Groupes privés** | Créer des groupes, ajouter des membres |   
| ⚡ **Fix Kick** | Correction du forceDisconnect |   
| 📝 **Fix Bio** | Sauvegarde corrigée + rechargement |   
| 👤 **Profil public** | Clic sur avatar → voir profil complet |   
| 🏆 **Classement** | Top messages envoyés |   
| 📸 **Stories/Notes** | Notes éphémères style Instagram (24h) |   
| 👆 **Swipe retour** | Swipe droite → retour liste (mobile) |   
| 📌 **Épinglage** | Épingler des conversations en haut |   
| 👁 **Voir MDP** | Icône œil sur les champs mot de passe |   
   
