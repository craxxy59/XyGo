# XyGo Firebase Backend

Ce dossier remplace le serveur Debian historique avec:

- Realtime Database (regles: `database.rules.json`)
- Cloud Functions HTTP (`functions/src/index.js`)
- Configuration projet (`.firebaserc`, `firebase.json`)

## Prerequis

- Node.js 20+
- Firebase CLI (`npm i -g firebase-tools`)
- Projet Firebase: `xygo-chat`

## Installation

```bash
cd firebase/functions
npm install
```

## Emulateurs

```bash
cd firebase
firebase emulators:start --only functions,database
```

## Deploy

```bash
cd firebase
firebase deploy --only database,functions
```

## Endpoint principal

- `https://europe-west1-xygo-chat.cloudfunctions.net/api`

Le frontend en mode Firebase appelle cet endpoint pour conserver la compatibilite avec les anciens appels `/api/*`.
