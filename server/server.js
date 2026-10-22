const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const multer = require('multer');
const csv = require('csv-parser');
const { Readable } = require('stream');


require('dotenv').config();
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});
const mongoose = require('mongoose');

const upload = multer({ storage: multer.memoryStorage() });

// MongoDB Connection
// Version Check Endpoint
app.get('/version', (req, res) => {
  res.json({
    version: '1.1.0',
    status: 'DB Connection Waiting Fix Applied',
    timestamp: new Date().toISOString()
  });
});

// MongoDB Connection & Server Start
const startServer = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    const PORT = process.env.PORT || 3000;
    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (err) {
    console.error('Failed to connect to MongoDB:', err);
    process.exit(1);
  }
};

startServer();

// Mongoose Schema & Model
const auctionSchema = new mongoose.Schema({
  teams: Array,
  players: Array,
  currentAuction: {
    playerId: Number,
    currentBid: Number,
    currentTeamId: Number,
    history: Array
  }
}, { timestamps: true });

const AuctionState = mongoose.model('AuctionState', auctionSchema);

app.use(cors());
app.use(express.json());

// Initialize or Get State
const getAuctionState = async () => {
  let state = await AuctionState.findOne();
  if (!state) {
    // Initialize from local template if DB is empty
    const templatePath = path.join(__dirname, 'data', 'auction.json');
    if (fs.existsSync(templatePath)) {
      const templateData = JSON.parse(fs.readFileSync(templatePath, 'utf8'));
      state = new AuctionState(templateData);
      await state.save();
      console.log("Initialized DB from template");
    } else {
      state = new AuctionState({
        teams: [],
        players: [],
        currentAuction: { playerId: null, currentBid: 0, currentTeamId: null, history: [] }
      });
      await state.save();
    }
  }
  return state;
};

// API to get initial state
app.get('/api/auction-state', async (req, res) => {
  try {
    const state = await getAuctionState();
    res.json(state);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// API to upload players CSV
app.post('/api/upload-players', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).send('No file uploaded.');
  }

  const results = [];
  const stream = Readable.from(req.file.buffer.toString());

  stream
    .pipe(csv())
    .on('data', (data) => {
      if (data.Name && data.Role) {
        results.push({
          id: Date.now() + Math.random(),
          name: data.Name,
          role: data.Role,
          rollNo: data.RollNo || "N/A",
          course: data.Course || "N/A",
          basePrice: parseInt(data.BasePrice) || 20,
          status: 'uncapped'
        });
      }
    })
    .on('end', async () => {
      try {
        const state = await getAuctionState();
        state.players = results;
        state.currentAuction = {
          playerId: null,
          currentBid: 0,
          currentTeamId: null,
          history: []
        };
        await state.save();
        io.emit('update', state);
        res.json({ message: 'Players uploaded successfully', count: results.length });
      } catch (err) {
        res.status(500).send(err.message);
      }
    });
});

// API to update teams
app.post('/api/update-teams', async (req, res) => {
  const { teams } = req.body;
  if (!teams || !Array.isArray(teams)) {
    return res.status(400).send('Invalid team data');
  }

  try {
    const state = await getAuctionState();
    state.teams = teams.map(newTeam => {
      const existing = state.teams.find(t => t.id === newTeam.id);
      if (existing) {
        return {
          ...existing,
          name: newTeam.name,
          budget: newTeam.budget,
          minSlots: newTeam.minSlots || 12,
          maxSlots: newTeam.maxSlots || 15,
          spent: existing.spent !== undefined ? existing.spent : 0 // Ensure spent is preserved or 0
        };
      }
      return {
        id: newTeam.id || Date.now(),
        name: newTeam.name,
        budget: newTeam.budget,
        minSlots: newTeam.minSlots || 12,
        maxSlots: newTeam.maxSlots || 15,
        spent: 0,
        players: []
      };
    });
    state.markModified('teams'); // Tell Mongoose array changed
    await state.save();
    io.emit('update', state);
    res.json({ message: 'Teams updated successfully' });
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// API: Add Player
app.post('/api/players', async (req, res) => {
  const { name, role, rollNo, course, basePrice } = req.body;
  if (!name || !role) return res.status(400).send("Name and Role required");

  try {
    const state = await getAuctionState();
    const newPlayer = {
      id: Date.now(),
      name,
      role,
      rollNo: rollNo || "N/A",
      course: course || "N/A",
      basePrice: parseInt(basePrice) || 200,
      status: 'uncapped'
    };
    state.players.push(newPlayer);
    state.markModified('players');
    await state.save();
    io.emit('update', state);
    res.json(newPlayer);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// API: Update Player
app.put('/api/players/:id', async (req, res) => {
  const { id } = req.params;
  const updates = req.body;

  try {
    const state = await getAuctionState();
    const idx = state.players.findIndex(p => p.id == id);
    if (idx === -1) return res.status(404).send("Player not found");

    state.players[idx] = { ...state.players[idx], ...updates };
    state.markModified('players');
    await state.save();
    io.emit('update', state);
    res.json(state.players[idx]);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// API: Delete Player
app.delete('/api/players/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const state = await getAuctionState();
    const initialLen = state.players.length;
    state.players = state.players.filter(p => p.id != id);

    if (state.players.length === initialLen) return res.status(404).send("Player not found");

    state.markModified('players');
    await state.save();
    io.emit('update', state);
    res.json({ success: true });
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// API: Reset Auction
app.post('/api/admin/reset', async (req, res) => {
  try {
    const state = await getAuctionState();
    state.teams = state.teams.map(t => ({ ...t, spent: 0, players: [] }));
    state.players = state.players.map(p => ({ ...p, status: 'uncapped', soldPrice: undefined, teamId: undefined }));
    state.currentAuction = { playerId: null, currentBid: 0, currentTeamId: null, history: [] };

    state.markModified('teams');
    state.markModified('players');
    state.markModified('currentAuction'); // Explicitly mark
    await state.save();
    io.emit('update', state);
    res.json({ success: true, message: "Auction Reset Successfully" });
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// API: Update Player Status (Sold/Captain -> Unsold)
app.put('/api/players/:id/status', async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  if (status !== 'unsold' && status !== 'uncapped') return res.status(400).send("Invalid status");

  try {
    const state = await getAuctionState();
    const playerIndex = state.players.findIndex(p => p.id == id);
    if (playerIndex === -1) return res.status(404).send("Player not found");

    const player = state.players[playerIndex];
    // Refund logic
    if ((player.status === 'sold' || player.status === 'captain') && player.teamId) {
      const teamIndex = state.teams.findIndex(t => t.id === player.teamId);
      if (teamIndex !== -1) {
        const refundAmount = player.soldPrice || 0;
        state.teams[teamIndex].spent -= refundAmount;
        state.teams[teamIndex].players = state.teams[teamIndex].players.filter(pId => pId != id);
        state.markModified('teams');
      }
    }

    state.players[playerIndex] = { ...player, status: status, soldPrice: undefined, teamId: undefined };
    state.markModified('players');
    await state.save();
    io.emit('update', state);
    res.json({ success: true, player: state.players[playerIndex] });
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// API: Assign Captain
app.post('/api/admin/assign-captain', async (req, res) => {
  const { playerId, teamId } = req.body;
  try {
    const state = await getAuctionState();
    const playerIndex = state.players.findIndex(p => p.id == playerId);
    if (playerIndex === -1) return res.status(404).json({ message: "Player not found" });

    const teamIndex = state.teams.findIndex(t => t.id === teamId);
    if (teamIndex === -1) return res.status(404).json({ message: "Team not found" });

    // Remove from old team
    const p = state.players[playerIndex];
    if (p.teamId) {
      const oldTeamIdx = state.teams.findIndex(t => t.id === p.teamId);
      if (oldTeamIdx !== -1) {
        state.teams[oldTeamIdx].players = state.teams[oldTeamIdx].players.filter(pid => pid != playerId);
        if (p.soldPrice) state.teams[oldTeamIdx].spent -= p.soldPrice;
        state.markModified('teams'); // Mark modified if we touched old team
      }
    }

    // Update Player & Team
    state.players[playerIndex] = { ...p, status: 'captain', soldPrice: 0, teamId: teamId };
    state.teams[teamIndex].players.push(Number(playerId));

    state.markModified('players');
    state.markModified('teams'); // Mark modified again for new team

    await state.save();
    io.emit('update', state);
    res.json({ success: true });
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// Socket.io connection
io.on('connection', async (socket) => {
  console.log('A user connected');

  try {
    const state = await getAuctionState();
    socket.emit('update', state);
  } catch (e) {
    console.error("Error sending initial state:", e);
  }

  // Admin: Select a player for auction
  socket.on('admin_select_player', async ({ playerId }) => {
    const state = await getAuctionState();
    const player = state.players.find(p => p.id === playerId);

    if (player && (player.status === 'uncapped' || player.status === 'unsold')) {
      state.currentAuction = {
        playerId: player.id,
        currentBid: 0,
        currentTeamId: null,
        history: []
      };

      state.markModified('currentAuction');
      await state.save();
      io.emit('update', state);
    }
  });

  // Admin: Place a bid
  socket.on('admin_place_bid', async ({ amount, teamId }) => {
    const state = await getAuctionState();

    if (!state.currentAuction.playerId) return;

    const team = state.teams.find(t => t.id === teamId);
    if (!team) return;

    if (team.budget - team.spent < amount) {
      socket.emit('error', { message: 'Insufficient funds' });
      return;
    }

    if (amount > state.currentAuction.currentBid) {
      state.currentAuction.currentBid = amount;
      state.currentAuction.currentTeamId = teamId;
      state.currentAuction.history.push({ teamId, amount, timestamp: new Date() });

      state.markModified('currentAuction');
      await state.save();
      io.emit('update', state);
    }
  });

  // Admin: Undo Last Bid
  socket.on('admin_undo_bid', async () => {
    const state = await getAuctionState();
    const { history } = state.currentAuction;

    if (history.length > 0) {
      history.pop();
      if (history.length > 0) {
        const lastBid = history[history.length - 1];
        state.currentAuction.currentBid = lastBid.amount;
        state.currentAuction.currentTeamId = lastBid.teamId;
      } else {
        state.currentAuction.currentBid = 0;
        state.currentAuction.currentTeamId = null;
      }
      state.currentAuction.history = history;

      state.markModified('currentAuction');
      await state.save();
      io.emit('update', state);
    }
  });

  // Admin: Sell Player
  socket.on('admin_sell_player', async () => {
    const state = await getAuctionState();
    const { playerId, currentBid, currentTeamId } = state.currentAuction;

    if (playerId && currentTeamId) {
      const playerIndex = state.players.findIndex(p => p.id === playerId);
      if (playerIndex !== -1) {
        state.players[playerIndex].status = 'sold';
        state.players[playerIndex].soldPrice = currentBid;
        state.players[playerIndex].teamId = currentTeamId;
      }

      const teamIndex = state.teams.findIndex(t => t.id === currentTeamId);
      if (teamIndex !== -1) {
        state.teams[teamIndex].spent += currentBid;
        state.teams[teamIndex].players.push(playerId);
      }

      state.currentAuction = {
        playerId: null,
        currentBid: 0,
        currentTeamId: null,
        history: []
      };

      state.markModified('players');
      state.markModified('teams');
      state.markModified('currentAuction');
      await state.save();
      io.emit('update', state);
    }
  });

  // Admin: Unsold Player
  socket.on('admin_unsold_player', async () => {
    const state = await getAuctionState();
    const { playerId } = state.currentAuction;

    if (playerId) {
      const playerIndex = state.players.findIndex(p => p.id === playerId);
      if (playerIndex !== -1) {
        state.players[playerIndex].status = 'unsold';
      }

      state.currentAuction = {
        playerId: null,
        currentBid: 0,
        currentTeamId: null,
        history: []
      };

      state.markModified('players');
      state.markModified('currentAuction');
      await state.save();
      io.emit('update', state);
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected');
  });
});

// Server start logic moved to startServer function above
