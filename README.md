# YouShadeBot

Discord management bot in JavaScript (discord.js v14) with **temporary voice channels**,
**live server stats** and **moderation tools**.

## Features

### Temporary Channels `/temp`
Users join a trigger voice channel and get their own personal voice channel created automatically.

- `/temp setup <channel>` — mark a channel as the trigger (the one users join)
- `/temp name <name>` — rename your channel
- `/temp limit <count>` — set the user limit (0 = unlimited)
- `/temp lock` / `/temp unlock` — control who can join
- `/temp claim` — take over an abandoned channel
- `/temp remove` — delete your channel
- `/temp disable` / `/temp info`

Empty temp channels auto-delete after 60 seconds (with a warning message).

### Channel Stats `/stats`
Creates voice channels showing live server numbers (updated every 5 minutes):

- 👥 Members: N
- 🤖 Bots: N
- 🟢 Online: N
- 🎤 In Voice: N

Commands: `/stats setup`, `/stats refresh`, `/stats disable`

### Moderation `/mod` and `/clear`
- `/mod kick <target> [reason]`
- `/mod ban <target> [days] [reason]`
- `/mod unban <user>`
- `/mod timeout <target> <minutes> [reason]`
- `/clear <amount>` — bulk delete messages

### Utility
- `/ping`, `/avatar`, `/userinfo`, `/serverinfo`, `/help`

## Setup

1. Clone and install:

```bash
npm install
```

2. Create your bot at https://discord.com/developers/applications
   and enable these intents: Server Members, Message Content, Voice State, Presence.
   Invite it with the `applications.commands` scope and appropriate permissions
   (Manage Channels, Manage Messages, Moderate Members, Move Members, View Channel).

3. Copy `.env.example` to `.env` and fill in:

```
TOKEN=your-bot-token-here
CLIENT_ID=your-application-id-here
GUILD_ID=optional-guild-id-for-quick-registration
PANEL_PASSWORD=admin
PANEL_HOST=127.0.0.1
PANEL_PORT=3000
```

`GUILD_ID` is optional. Commands register instantly with it; omit it to
register globally (takes up to an hour for new commands to be cached).

4. Run:

```bash
npm start      # or npm run dev for auto-reload
```

## Management panel

The bot serves a local web dashboard for configuration at
`http://127.0.0.1:3000` (default password `PANEL_PASSWORD` = `admin`).

From the panel you can:

- See live bot status (ping, uptime, servers, members)
- Pick any server the bot is in
- Set/disable the **temporary channel** trigger
- Create/refresh/remove the **server stats** channels
- Re-register slash commands

## Project structure

```
src/
  index.js            # client setup + startup
  commands/           # slash commands (one file each)
  events/             # clientReady, interactionCreate, voiceStateUpdate
  panel/
    server.js         # local dashboard API + static server
    public/           # dashboard frontend (HTML/CSS/JS)
  utils/
    db.js             # JSON persistence (data/store.json)
    temp.js           # temporary channel logic
    stats.js          # stats channel logic
```