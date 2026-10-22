# 🏏 TPL 2026 - Cricket Auction Manager

A real-time, interactive cricket player auction management system built with **React 19 + Vite**, with instant multi-screen sync, team budget tracking, bid calculations, and CSV export.

---

## ⚡ Features

- **Preloaded Roster**: 47 players preloaded with categories, roles (Fast/Medium pacers, Spinners, Batsmen), college courses, and base prices.
- **Vercel-Ready (Zero-Config)**: Runs directly on Vercel with real-time cross-tab synchronization (`BroadcastChannel` & `localStorage`).
- **Live Public Dashboard (`/`)**: High-contrast, projector-ready display showing active bids, player spotlights, squad counts, remaining team purse, and maximum bid calculators.
- **Admin Control Panel (`/admin`)**:
  - Start player auctions, bid increment shortcuts (+₹10L, +₹20L, +₹25L), undo bids.
  - Sell / Unsold / Retain as Captain controls.
  - Manage teams, edit budgets, add/edit/delete players.
  - CSV player import & full auction result export.
  - Default Admin Password: `Sirappu`

---

## 🚀 How to Deploy on Vercel

1. Push this repository to GitHub.
2. Go to [vercel.com/new](https://vercel.com/new) and import your GitHub repository.
3. Vercel will auto-detect **Vite** and build from `client/` using the included `vercel.json`.
4. Click **Deploy**.

---

## 💻 Local Development

### Run Frontend:
```bash
cd client
npm install
npm run dev
```

### (Optional) Run Node.js + Socket.io Server:
```bash
cd server
npm install
npm start
```

---

## 📁 Project Structure

```
├── client/                 # React 19 + Vite Frontend
│   ├── public/             # Static assets & players.csv
│   ├── src/
│   │   ├── pages/          # Dashboard (public) & AdminPanel
│   │   ├── utils/          # Real-time state synchronization
│   │   └── data/           # 47 Pre-loaded player profiles
│   └── vercel.json         # SPA route rewrite configuration
├── server/                 # Node.js + Express + Socket.io Server (Optional)
│   ├── data/               # auction.json template & players.csv
│   └── server.js           # WebSocket backend
├── vercel.json             # Root Vercel deployment instructions
├── .gitignore              # Ignores node_modules, dist, and env files
└── README.md
```
