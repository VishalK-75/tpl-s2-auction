import React, { useEffect, useState } from 'react';
import { socket, SERVER_URL, getStoredState, saveLocalState } from '../utils/auctionSync';

const SQUAD_SIZE = 12;

function AdminPanel() {
    const [data, setData] = useState(() => getStoredState());
    const [selectedPlayerId, setSelectedPlayerId] = useState('');
    const [isConnected, setIsConnected] = useState(socket ? socket.connected : false);
    const [activeTab, setActiveTab] = useState('auction'); // auction, players, teams, settings
    const [file, setFile] = useState(null);
    const [teamEdits, setTeamEdits] = useState([]);

    // Player Management State
    const [searchTerm, setSearchTerm] = useState("");
    const [editingPlayer, setEditingPlayer] = useState(null);

    // Captain State
    const [captainPlayerId, setCaptainPlayerId] = useState("");
    const [captainTeamId, setCaptainTeamId] = useState("");
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [passwordInput, setPasswordInput] = useState("");

    // Bulk Action State
    const [selectedPlayerIds, setSelectedPlayerIds] = useState([]);

    // Synchronize teamEdits
    useEffect(() => {
        if (data && data.teams && teamEdits.length === 0) {
            setTeamEdits(data.teams);
        }
    }, [data]);

    // Sync listener for cross-tab and socket updates
    useEffect(() => {
        // 1. Cross-tab BroadcastChannel
        let channel = null;
        if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
            channel = new BroadcastChannel('tpl_auction_channel');
            channel.onmessage = (event) => {
                if (event.data && event.data.type === 'UPDATE' && event.data.data) {
                    setData(event.data.data);
                }
            };
        }

        // 2. Storage event
        const handleStorage = (e) => {
            if (e.key === 'tpl_auction_state_v2' && e.newValue) {
                try {
                    setData(JSON.parse(e.newValue));
                } catch (err) {
                    console.error("Storage error", err);
                }
            }
        };
        window.addEventListener('storage', handleStorage);

        // 3. Socket updates
        if (socket) {
            function onConnect() {
                setIsConnected(true);
            }
            function onDisconnect() {
                setIsConnected(false);
            }
            function onUpdate(newData) {
                setData(newData);
                saveLocalState(newData);
            }

            socket.on('connect', onConnect);
            socket.on('disconnect', onDisconnect);
            socket.on('update', onUpdate);

            if (socket.connected) onConnect();

            // Try backend state
            if (SERVER_URL) {
                fetch(`${SERVER_URL}/api/auction-state`)
                    .then(res => res.json())
                    .then(serverData => {
                        if (serverData && serverData.teams) {
                            setData(serverData);
                            saveLocalState(serverData);
                        }
                    })
                    .catch(() => {
                        // Backend offline, keep local state
                    });
            }

            return () => {
                socket.off('connect', onConnect);
                socket.off('disconnect', onDisconnect);
                socket.off('update', onUpdate);
                if (channel) channel.close();
                window.removeEventListener('storage', handleStorage);
            };
        }

        return () => {
            if (channel) channel.close();
            window.removeEventListener('storage', handleStorage);
        };
    }, []);

    // Helper to persist state both locally and to server
    const commitState = (newState) => {
        setData(newState);
        saveLocalState(newState);
    };

    if (!isAuthenticated) {
        return (
            <div className="container" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
                <div className="glass-card" style={{ padding: '40px', width: '400px', textAlign: 'center' }}>
                    <h2>Admin Access</h2>
                    <input
                        type="password"
                        placeholder="Enter Admin Password"
                        value={passwordInput}
                        onChange={(e) => setPasswordInput(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                if (passwordInput === "Sirappu") setIsAuthenticated(true);
                                else alert("Incorrect Password");
                            }
                        }}
                        style={{ width: '100%', padding: '10px', marginTop: '20px', marginBottom: '20px', borderRadius: '5px', border: '1px solid #555', background: '#333', color: 'white' }}
                    />
                    <button
                        className="btn btn-primary"
                        style={{ width: '100%' }}
                        onClick={() => {
                            if (passwordInput === "Sirappu") {
                                setIsAuthenticated(true);
                            } else {
                                alert("Incorrect Password");
                            }
                        }}
                    >
                        Login
                    </button>
                </div>
            </div>
        );
    }

    if (!data) return <div className="container">Loading Admin Panel...</div>;

    const { players = [], teams = [], currentAuction = { playerId: null, currentBid: 0, currentTeamId: null, history: [] } } = data;

    // --- Logic Helpers ---
    const calculateMaxBid = (team) => {
        const MIN_BASE_PRICE = 100;
        const filledSlots = (team.players || []).length;
        const minSlots = team.minSlots || 12;
        const maxSlots = team.maxSlots || 15;

        if (filledSlots >= maxSlots) return 0;

        const remainingSlotsToMin = minSlots - filledSlots;
        let slotsToReserve = 0;
        if (remainingSlotsToMin > 0) {
            slotsToReserve = remainingSlotsToMin - 1;
        }
        if (slotsToReserve < 0) slotsToReserve = 0;

        const reservedAmount = slotsToReserve * MIN_BASE_PRICE;
        const currentPurse = team.budget - team.spent;
        const maxBid = currentPurse - reservedAmount;
        return maxBid > 0 ? maxBid : 0;
    };

    const getNextBidAmount = (currentBid) => {
        if (!currentBid || currentBid === 0) return 100;
        if (currentBid < 100) return 100;
        if (currentBid < 200) return currentBid + 10;
        if (currentBid < 500) return currentBid + 20;
        return currentBid + 25;
    };

    // --- Auction Handlers ---
    const handleSelectPlayer = () => {
        if (!selectedPlayerId) return;
        const pId = Number(selectedPlayerId);

        if (socket && socket.connected) {
            socket.emit('admin_select_player', { playerId: pId });
        }

        const p = players.find(x => x.id === pId);
        const updated = {
            ...data,
            currentAuction: {
                playerId: pId,
                currentBid: p ? (p.basePrice || 100) : 100,
                currentTeamId: null,
                history: []
            }
        };
        commitState(updated);
        setSelectedPlayerId('');
    };

    const placeBid = (teamId) => {
        const nextBid = getNextBidAmount(currentAuction.currentBid);
        const team = teams.find(t => t.id === teamId);
        const maxBid = calculateMaxBid(team);

        if (nextBid > maxBid) {
            alert(`Bid exceeds Max Bid limit (₹${maxBid}L) for ${team.name}!`);
            return;
        }

        if (socket && socket.connected) {
            socket.emit('admin_place_bid', { teamId, amount: nextBid });
        }

        const updated = {
            ...data,
            currentAuction: {
                ...currentAuction,
                currentBid: nextBid,
                currentTeamId: teamId,
                history: [...(currentAuction.history || []), { teamId, amount: nextBid, timestamp: new Date().toISOString() }]
            }
        };
        commitState(updated);
    };

    const sellPlayer = () => {
        if (!currentAuction.playerId || !currentAuction.currentTeamId) {
            alert("No active bid to sell!");
            return;
        }

        const team = teams.find(t => t.id === currentAuction.currentTeamId);
        if (!window.confirm(`Sell player to ${team?.name} for ₹${currentAuction.currentBid}L?`)) return;

        if (socket && socket.connected) {
            socket.emit('admin_sell_player');
        }

        const { playerId, currentBid, currentTeamId } = currentAuction;
        const updatedPlayers = players.map(p => {
            if (p.id === playerId) {
                return { ...p, status: 'sold', soldPrice: currentBid, teamId: currentTeamId };
            }
            return p;
        });

        const updatedTeams = teams.map(t => {
            if (t.id === currentTeamId) {
                return {
                    ...t,
                    spent: (t.spent || 0) + currentBid,
                    players: [...(t.players || []), playerId]
                };
            }
            return t;
        });

        const updated = {
            ...data,
            players: updatedPlayers,
            teams: updatedTeams,
            currentAuction: { playerId: null, currentBid: 0, currentTeamId: null, history: [] }
        };
        commitState(updated);
    };

    const unsoldPlayer = () => {
        if (!currentAuction.playerId) return;
        if (!window.confirm('Mark player as Unsold?')) return;

        if (socket && socket.connected) {
            socket.emit('admin_unsold_player');
        }

        const { playerId } = currentAuction;
        const updatedPlayers = players.map(p => {
            if (p.id === playerId) {
                return { ...p, status: 'unsold' };
            }
            return p;
        });

        const updated = {
            ...data,
            players: updatedPlayers,
            currentAuction: { playerId: null, currentBid: 0, currentTeamId: null, history: [] }
        };
        commitState(updated);
    };

    const handleUndoBid = () => {
        if (!window.confirm("Undo the last bid?")) return;

        if (socket && socket.connected) {
            socket.emit('admin_undo_bid');
        }

        const history = [...(currentAuction.history || [])];
        if (history.length === 0) return;

        history.pop();
        const prev = history[history.length - 1];
        const p = players.find(x => x.id === currentAuction.playerId);

        const updated = {
            ...data,
            currentAuction: {
                ...currentAuction,
                history,
                currentBid: prev ? prev.amount : (p?.basePrice || 100),
                currentTeamId: prev ? prev.teamId : null
            }
        };
        commitState(updated);
    };

    // --- Bulk / Player Actions ---
    const toggleSelectAll = (e) => {
        if (e.target.checked) setSelectedPlayerIds(players.map(p => p.id));
        else setSelectedPlayerIds([]);
    };

    const toggleSelectPlayer = (id) => {
        if (selectedPlayerIds.includes(id)) {
            setSelectedPlayerIds(selectedPlayerIds.filter(pid => pid !== id));
        } else {
            setSelectedPlayerIds([...selectedPlayerIds, id]);
        }
    };

    const handleBulkDelete = async () => {
        if (selectedPlayerIds.length === 0) return;
        if (!window.confirm(`Delete ${selectedPlayerIds.length} players?`)) return;

        if (socket && socket.connected && SERVER_URL) {
            try {
                await Promise.all(selectedPlayerIds.map(id =>
                    fetch(`${SERVER_URL}/api/players/${id}`, { method: 'DELETE' })
                ));
            } catch (err) { console.warn(err); }
        }

        const updatedPlayers = players.filter(p => !selectedPlayerIds.includes(p.id));
        commitState({ ...data, players: updatedPlayers });
        setSelectedPlayerIds([]);
        alert("Players deleted!");
    };

    const handleSavePlayer = async (e) => {
        e.preventDefault();
        const p = editingPlayer;

        if (socket && socket.connected && SERVER_URL) {
            const url = p.id ? `${SERVER_URL}/api/players/${p.id}` : `${SERVER_URL}/api/players`;
            const method = p.id ? 'PUT' : 'POST';
            try {
                await fetch(url, {
                    method,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(p)
                });
            } catch (err) { console.warn(err); }
        }

        let updatedPlayers = [...players];
        if (p.id) {
            updatedPlayers = updatedPlayers.map(item => item.id === p.id ? { ...item, ...p } : item);
        } else {
            updatedPlayers.push({
                ...p,
                id: Date.now(),
                status: 'uncapped'
            });
        }

        commitState({ ...data, players: updatedPlayers });
        setEditingPlayer(null);
    };

    const handleDeletePlayer = async (id) => {
        if (!window.confirm("Delete this player?")) return;

        if (socket && socket.connected && SERVER_URL) {
            try {
                await fetch(`${SERVER_URL}/api/players/${id}`, { method: 'DELETE' });
            } catch (err) { console.warn(err); }
        }

        const updatedPlayers = players.filter(p => p.id !== id);
        commitState({ ...data, players: updatedPlayers });
    };

    const handleMarkUnsold = async (id) => {
        if (!window.confirm("Mark this sold player as Unsold? This will refund the team.")) return;

        if (socket && socket.connected && SERVER_URL) {
            try {
                await fetch(`${SERVER_URL}/api/players/${id}/status`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ status: 'unsold' })
                });
            } catch (err) { console.warn(err); }
        }

        const p = players.find(x => x.id === id);
        let updatedTeams = [...teams];
        if (p && p.teamId) {
            updatedTeams = updatedTeams.map(t => {
                if (t.id === p.teamId) {
                    return {
                        ...t,
                        spent: Math.max(0, (t.spent || 0) - (p.soldPrice || 0)),
                        players: (t.players || []).filter(pid => pid !== id)
                    };
                }
                return t;
            });
        }

        const updatedPlayers = players.map(x => x.id === id ? { ...x, status: 'unsold', soldPrice: undefined, teamId: undefined } : x);
        commitState({ ...data, players: updatedPlayers, teams: updatedTeams });
    };

    const handleAssignCaptain = async () => {
        if (!captainPlayerId || !captainTeamId) return alert("Select player and team");
        if (!window.confirm("Assign this player as Captain? Cost will be 0.")) return;

        const pId = Number(captainPlayerId);
        const tId = Number(captainTeamId);

        if (socket && socket.connected && SERVER_URL) {
            try {
                await fetch(`${SERVER_URL}/api/admin/assign-captain`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ playerId: pId, teamId: tId })
                });
            } catch (err) { console.warn(err); }
        }

        const updatedTeams = teams.map(t => {
            let pList = (t.players || []).filter(id => id !== pId);
            if (t.id === tId) pList.push(pId);
            return { ...t, players: pList };
        });

        const updatedPlayers = players.map(p => {
            if (p.id === pId) return { ...p, status: 'captain', soldPrice: 0, teamId: tId };
            return p;
        });

        commitState({ ...data, players: updatedPlayers, teams: updatedTeams });
        alert("Captain Assigned!");
        setCaptainPlayerId("");
        setCaptainTeamId("");
    };

    const handleTeamSave = async () => {
        if (socket && socket.connected && SERVER_URL) {
            try {
                await fetch(`${SERVER_URL}/api/update-teams`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ teams: teamEdits })
                });
            } catch (err) { console.warn(err); }
        }

        commitState({ ...data, teams: teamEdits });
        alert("Teams updated successfully!");
    };

    const handleDeleteTeam = async (teamId) => {
        const teamToDelete = teams.find(t => t.id === teamId);
        if (!teamToDelete) return;

        const teamPlayersCount = (teamToDelete.players || []).length;
        const msg = teamPlayersCount > 0
            ? `Remove "${teamToDelete.name}"? This team has ${teamPlayersCount} player(s) that will be released back to the unsold pool.`
            : `Are you sure you want to remove "${teamToDelete.name}"?`;

        if (!window.confirm(msg)) return;

        const updatedTeams = teams.filter(t => t.id !== teamId);
        const updatedTeamEdits = teamEdits.filter(t => t.id !== teamId);

        // Release any players assigned to this team
        const updatedPlayers = players.map(p => {
            if (p.teamId === teamId) {
                return { ...p, status: 'uncapped', soldPrice: undefined, teamId: undefined };
            }
            return p;
        });

        // Reset current auction holder if it was this team
        let updatedAuction = { ...currentAuction };
        if (updatedAuction.currentTeamId === teamId) {
            updatedAuction.currentTeamId = null;
        }

        const newState = {
            ...data,
            teams: updatedTeams,
            players: updatedPlayers,
            currentAuction: updatedAuction
        };

        setTeamEdits(updatedTeamEdits);
        commitState(newState);

        if (socket && socket.connected && SERVER_URL) {
            try {
                await fetch(`${SERVER_URL}/api/update-teams`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ teams: updatedTeams })
                });
            } catch (err) { console.warn(err); }
        }

        alert(`Team "${teamToDelete.name}" removed!`);
    };

    const handleAddTeam = () => {
        const newTeamLetter = String.fromCharCode(65 + teams.length);
        const newId = Date.now();
        const newTeam = {
            id: newId,
            name: `Team ${newTeamLetter}`,
            budget: 6000,
            spent: 0,
            players: [],
            minSlots: 12,
            maxSlots: 15
        };

        const updatedTeams = [...teams, newTeam];
        const updatedTeamEdits = [...teamEdits, newTeam];
        setTeamEdits(updatedTeamEdits);
        commitState({ ...data, teams: updatedTeams });
    };

    const handleFileUpload = async () => {
        if (!file) return;

        // Try backend upload if available
        if (socket && socket.connected && SERVER_URL) {
            const formData = new FormData();
            formData.append('file', file);
            try {
                await fetch(`${SERVER_URL}/api/upload-players`, { method: 'POST', body: formData });
                alert('Players uploaded to server!');
                setFile(null);
                return;
            } catch (err) { console.warn(err); }
        }

        // Standalone / Vercel browser parsing
        const reader = new FileReader();
        reader.onload = (e) => {
            const text = e.target.result;
            const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
            if (lines.length <= 1) return alert("File is empty or invalid");

            const newPlayers = [];
            for (let i = 1; i < lines.length; i++) {
                const parts = lines[i].split(',').map(s => s.trim());
                if (parts[0]) {
                    newPlayers.push({
                        id: Date.now() + i,
                        name: parts[0],
                        role: parts[1] || 'Batsman',
                        rollNo: parts[2] || `${100 + i}`,
                        course: parts[3] || 'N/A',
                        basePrice: parseInt(parts[4]) || 100,
                        status: 'uncapped'
                    });
                }
            }

            if (newPlayers.length > 0) {
                commitState({
                    ...data,
                    players: newPlayers,
                    currentAuction: { playerId: null, currentBid: 0, currentTeamId: null, history: [] }
                });
                alert(`Successfully loaded ${newPlayers.length} players!`);
                setFile(null);
            }
        };
        reader.readAsText(file);
    };

    const handleResetAuction = async () => {
        if (!window.confirm("CRITICAL WARNING: This will reset ALL auction progress, clear all teams, and mark all players as unsold. Are you sure?")) return;
        const confirm2 = window.prompt("Type 'RESET' to confirm:");
        if (confirm2 !== 'RESET') return;

        if (socket && socket.connected && SERVER_URL) {
            try {
                await fetch(`${SERVER_URL}/api/admin/reset`, { method: 'POST' });
            } catch (err) { console.warn(err); }
        }

        const resetTeams = teams.map(t => ({ ...t, spent: 0, players: [] }));
        const resetPlayers = players.map(p => ({ ...p, status: 'uncapped', soldPrice: undefined, teamId: undefined }));
        const updated = {
            ...data,
            teams: resetTeams,
            players: resetPlayers,
            currentAuction: { playerId: null, currentBid: 0, currentTeamId: null, history: [] }
        };

        commitState(updated);
        alert("Auction Reset Successfully!");
    };

    const downloadCSV = () => {
        let csvContent = "data:text/csv;charset=utf-8,";
        csvContent += "Team,Player Name,Role,Price (L),Status\n";

        teams.forEach(team => {
            const teamPlayers = players.filter(p => p.teamId === team.id);
            if (teamPlayers.length === 0) {
                csvContent += `${team.name},-, -,-,Empty Squad\n`;
            } else {
                teamPlayers.forEach(p => {
                    csvContent += `${team.name},"${p.name}","${p.role}",${p.soldPrice || 0},${p.status === 'captain' ? 'Captain' : 'Sold'}\n`;
                });
            }
        });

        const unsolds = players.filter(p => p.status === 'unsold' || p.status === 'uncapped');
        unsolds.forEach(p => {
            csvContent += `Unsold,"${p.name}","${p.role}",0,Unsold\n`;
        });

        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", "tpl_auction_data.csv");
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const uncappedPlayers = players.filter(p => p.status === 'uncapped' || p.status === 'unsold');

    return (
        <div className="container">
            <header>
                <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                    <div className="logo">ADMIN PANEL</div>
                    <span style={{ fontSize: '0.75rem', padding: '4px 8px', borderRadius: '12px', background: isConnected ? '#00e676' : '#29b6f6', color: 'black', fontWeight: 'bold' }}>
                        {isConnected ? '● Server Live' : '● Vercel/Local Mode'}
                    </span>
                </div>
                <div style={{ display: 'flex', gap: '10px' }}>
                    <button className={`btn ${activeTab === 'auction' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setActiveTab('auction')}>🔨 Auction</button>
                    <button className={`btn ${activeTab === 'players' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setActiveTab('players')}>📝 Manage Players ({players.length})</button>
                    <button className={`btn ${activeTab === 'teams' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setActiveTab('teams')}>👥 Team Lists</button>
                    <button className={`btn ${activeTab === 'settings' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setActiveTab('settings')}>⚙️ Settings</button>
                    <a href="/" target="_blank" rel="noreferrer" className="btn btn-secondary">🖥️ Open Public Dashboard</a>
                </div>
            </header>

            {/* === AUCTION TAB === */}
            {activeTab === 'auction' && (
                <div className="auction-grid">
                    <div className="glass-card control-panel">
                        {!currentAuction.playerId ? (
                            <div>
                                <h3>Select Next Player for Auction</h3>
                                <div style={{ display: 'flex', gap: '10px', marginTop: '15px' }}>
                                    <select
                                        value={selectedPlayerId}
                                        onChange={(e) => setSelectedPlayerId(e.target.value)}
                                        style={{ marginBottom: 0, flex: 1, padding: '10px' }}
                                    >
                                        <option value="">-- Choose Player ({uncappedPlayers.length} Available) --</option>
                                        {uncappedPlayers.map(p => (
                                            <option key={p.id} value={p.id}>
                                                {p.name} ({p.role}) - Roll: {p.rollNo}
                                            </option>
                                        ))}
                                    </select>
                                    <button className="btn btn-primary" onClick={handleSelectPlayer}>▶️ Start Auction</button>
                                </div>
                            </div>
                        ) : (
                            <div>
                                <h3>Current Auction: {players.find(p => p.id === currentAuction.playerId)?.name}</h3>
                                <div className="current-bid" style={{ fontSize: '2.5rem', margin: '15px 0' }}>
                                    Current: ₹{currentAuction.currentBid} L
                                    {currentAuction.currentTeamId ? ` (${teams.find(t => t.id === currentAuction.currentTeamId)?.name})` : ' (No Bids Yet)'}
                                </div>

                                <div style={{ marginTop: '20px' }}>
                                    <h4>Place Bid for Team</h4>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                                        <p style={{ fontSize: '0.9rem', color: '#aaa', margin: 0 }}>
                                            Next Bid: ₹{getNextBidAmount(currentAuction.currentBid)}L (+{getNextBidAmount(currentAuction.currentBid) - currentAuction.currentBid}L)
                                        </p>
                                        {(currentAuction.history || []).length > 0 && (
                                            <button className="btn btn-secondary" onClick={handleUndoBid} style={{ padding: '5px 10px', fontSize: '0.8rem', background: '#555', color: 'white' }}>
                                                ↩️ Undo Last Bid
                                            </button>
                                        )}
                                    </div>

                                    <div style={{ display: 'grid', gap: '10px' }}>
                                        {teams.map(team => {
                                            const maxBid = calculateMaxBid(team);
                                            const nextBid = getNextBidAmount(currentAuction.currentBid);
                                            const isOut = nextBid > maxBid;

                                            return (
                                                <div key={team.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px', background: isOut ? 'rgba(255,0,0,0.1)' : 'rgba(255,255,255,0.05)', borderRadius: '8px' }}>
                                                    <div>
                                                        <span style={{ fontWeight: 'bold' }}>{team.name}</span>
                                                        <div style={{ fontSize: '0.8rem', color: '#aaa' }}>
                                                            Purse: ₹{team.budget - team.spent}L | Max Bid: ₹{maxBid}L | Slots: {(team.players || []).length}/{team.maxSlots || 15}
                                                        </div>
                                                    </div>
                                                    <button
                                                        disabled={isOut}
                                                        className="btn btn-secondary"
                                                        style={{ padding: '8px 20px', background: isOut ? '#333' : 'var(--primary)', color: isOut ? '#555' : 'black', border: 'none', cursor: isOut ? 'not-allowed' : 'pointer' }}
                                                        onClick={() => placeBid(team.id)}
                                                    >
                                                        💰 Bid ₹{nextBid}L
                                                    </button>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>

                                <div className="action-controls" style={{ marginTop: '30px', borderTop: '1px solid #333', paddingTop: '20px', display: 'flex', gap: '15px' }}>
                                    <button className="btn btn-primary" onClick={sellPlayer} disabled={!currentAuction.currentTeamId} style={{ flex: 1 }}>
                                        ✅ SOLD to {teams.find(t => t.id === currentAuction.currentTeamId)?.name || 'Current Holder'}
                                    </button>
                                    <button className="btn btn-danger" onClick={unsoldPlayer} style={{ flex: 1 }}>
                                        ❌ UNSOLD / PASS
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="sidebar" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                        <div className="glass-card">
                            <h3>Mini Standings</h3>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                                <thead>
                                    <tr style={{ textAlign: 'left', borderBottom: '1px solid #555' }}>
                                        <th style={{ padding: '6px' }}>Team</th>
                                        <th>Purse</th>
                                        <th>Slots</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {teams.map(t => (
                                        <tr key={t.id} style={{ borderBottom: '1px solid #333' }}>
                                            <td style={{ padding: '6px' }}>{t.name}</td>
                                            <td style={{ color: 'var(--primary)', fontWeight: 'bold' }}>₹{t.budget - t.spent}L</td>
                                            <td>{(t.players || []).length}/{t.maxSlots || 15}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        <div className="glass-card">
                            <h3>Bid History</h3>
                            <ul style={{ listStyle: 'none', padding: 0, margin: 0, maxHeight: '250px', overflowY: 'auto' }}>
                                {(currentAuction.history || []).slice().reverse().map((bid, i) => (
                                    <li key={i} style={{ padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                                        <span style={{ color: 'var(--primary)', fontWeight: 'bold' }}>₹{bid.amount}L</span> by {teams.find(t => t.id === bid.teamId)?.name}
                                    </li>
                                ))}
                                {(!currentAuction.history || currentAuction.history.length === 0) && (
                                    <li style={{ color: '#888', fontStyle: 'italic', padding: '10px 0' }}>No bids yet for current player</li>
                                )}
                            </ul>
                        </div>
                    </div>
                </div>
            )}

            {/* === SETTINGS TAB === */}
            {activeTab === 'settings' && (
                <div className="container">
                    <div className="glass-card" style={{ marginBottom: '20px' }}>
                        <h3>Upload Players (CSV)</h3>
                        <p style={{ fontSize: '0.85rem', color: '#aaa' }}>
                            CSV Headers: <code>Name,Role,RollNo,Course,BasePrice</code>
                        </p>
                        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginTop: '10px' }}>
                            <input type="file" accept=".csv" onChange={e => setFile(e.target.files[0])} />
                            <button className="btn btn-primary" onClick={handleFileUpload} disabled={!file}>
                                📂 Upload CSV
                            </button>
                            <a href="/players.csv" download="tpl_players.csv" className="btn btn-secondary">
                                ⬇️ Download Current CSV Template
                            </a>
                        </div>
                    </div>

                    <div className="glass-card">
                        <h3>Edit Teams & Purse</h3>

                        <div style={{ marginBottom: '20px', padding: '15px', background: 'rgba(255,255,255,0.05)', borderRadius: '8px' }}>
                            <h4>👑 Assign Captain (Retained / Icon Player - ₹0 Cost)</h4>
                            <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
                                <select value={captainPlayerId} onChange={e => setCaptainPlayerId(e.target.value)} style={{ flex: 1 }}>
                                    <option value="">-- Select Player --</option>
                                    {players.map(p => <option key={p.id} value={p.id}>{p.name} ({p.role})</option>)}
                                </select>
                                <select value={captainTeamId} onChange={e => setCaptainTeamId(e.target.value)} style={{ flex: 1 }}>
                                    <option value="">-- Select Team --</option>
                                    {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                                </select>
                                <button className="btn btn-primary" onClick={handleAssignCaptain}>👑 Assign</button>
                            </div>
                        </div>

                        <div style={{ display: 'grid', gap: '10px' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px 90px 70px 70px 45px', gap: '10px', color: '#aaa', fontSize: '0.85rem' }}>
                                <div>Team Name</div>
                                <div>Budget (L)</div>
                                <div>Spent (L)</div>
                                <div>Min Slots</div>
                                <div>Max Slots</div>
                                <div>Action</div>
                            </div>
                            {teamEdits.map((team, idx) => (
                                <div key={team.id} style={{ display: 'grid', gridTemplateColumns: '1fr 90px 90px 70px 70px 45px', gap: '10px', alignItems: 'center' }}>
                                    <input
                                        style={{ padding: '8px', background: '#333', border: '1px solid #555', color: 'white' }}
                                        value={team.name}
                                        onChange={e => {
                                            const newTeams = [...teamEdits];
                                            newTeams[idx] = { ...newTeams[idx], name: e.target.value };
                                            setTeamEdits(newTeams);
                                        }}
                                        placeholder="Team Name"
                                    />
                                    <input
                                        type="number"
                                        style={{ padding: '8px', background: '#333', border: '1px solid #555', color: 'white' }}
                                        value={team.budget}
                                        onChange={e => {
                                            const newTeams = [...teamEdits];
                                            newTeams[idx] = { ...newTeams[idx], budget: parseInt(e.target.value) || 0 };
                                            setTeamEdits(newTeams);
                                        }}
                                        title="Total Budget (Lakhs)"
                                    />
                                    <input
                                        type="number"
                                        style={{ padding: '8px', background: '#333', border: '1px solid #555', color: 'white' }}
                                        value={team.spent}
                                        onChange={e => {
                                            const newTeams = [...teamEdits];
                                            newTeams[idx] = { ...newTeams[idx], spent: parseInt(e.target.value) || 0 };
                                            setTeamEdits(newTeams);
                                        }}
                                        title="Spent (Lakhs)"
                                    />
                                    <input
                                        type="number"
                                        style={{ padding: '8px', background: '#333', border: '1px solid #555', color: 'white' }}
                                        value={team.minSlots || 12}
                                        onChange={e => {
                                            const newTeams = [...teamEdits];
                                            newTeams[idx] = { ...newTeams[idx], minSlots: parseInt(e.target.value) || 12 };
                                            setTeamEdits(newTeams);
                                        }}
                                        title="Min Slots"
                                    />
                                    <input
                                        type="number"
                                        style={{ padding: '8px', background: '#333', border: '1px solid #555', color: 'white' }}
                                        value={team.maxSlots || 15}
                                        onChange={e => {
                                            const newTeams = [...teamEdits];
                                            newTeams[idx] = { ...newTeams[idx], maxSlots: parseInt(e.target.value) || 15 };
                                            setTeamEdits(newTeams);
                                        }}
                                        title="Max Slots"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => handleDeleteTeam(team.id)}
                                        title={`Delete ${team.name}`}
                                        style={{
                                            background: '#e53e3e',
                                            border: 'none',
                                            borderRadius: '5px',
                                            color: 'white',
                                            padding: '8px 5px',
                                            cursor: 'pointer',
                                            fontSize: '1rem',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center'
                                        }}
                                    >
                                        🗑️
                                    </button>
                                </div>
                            ))}
                            <div style={{ display: 'flex', gap: '15px', marginTop: '20px' }}>
                                <button className="btn btn-primary" onClick={handleTeamSave}>💾 Save Teams</button>
                                <button type="button" className="btn btn-secondary" onClick={handleAddTeam} style={{ background: '#333', border: '1px solid #666' }}>➕ Add New Team</button>
                            </div>
                        </div>

                        <div style={{ marginTop: '40px', borderTop: '1px solid #444', paddingTop: '20px' }}>
                            <h3 style={{ color: 'red' }}>Danger Zone</h3>
                            <button className="btn btn-danger" onClick={handleResetAuction}>⚠️ RESET ENTIRE AUCTION</button>
                        </div>
                    </div>
                </div>
            )}

            {/* === MANAGE PLAYERS TAB === */}
            {activeTab === 'players' && (
                <div className="container">
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px' }}>
                        <input
                            type="text"
                            placeholder="Search Players by name or role..."
                            style={{ padding: '10px', width: '320px', borderRadius: '5px', border: '1px solid #555', background: '#222', color: 'white' }}
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                        />
                        <div style={{ display: 'flex', gap: '10px' }}>
                            {selectedPlayerIds.length > 0 && (
                                <button className="btn btn-danger" onClick={handleBulkDelete}>
                                    🗑️ Delete ({selectedPlayerIds.length})
                                </button>
                            )}
                            <button className="btn btn-primary" onClick={() => setEditingPlayer({ name: '', role: 'Right-arm Medium Pacer', rollNo: '', course: '', basePrice: 100 })}>
                                ➕ Add New Player
                            </button>
                        </div>
                    </div>

                    {editingPlayer && (
                        <div className="glass-card" style={{ marginBottom: '20px', background: '#2d3748' }}>
                            <h3>{editingPlayer.id ? 'Edit Player' : 'Add Player'}</h3>
                            <form onSubmit={handleSavePlayer} style={{ display: 'grid', gap: '10px', gridTemplateColumns: '1fr 1fr' }}>
                                <input placeholder="Name" required value={editingPlayer.name} onChange={e => setEditingPlayer({ ...editingPlayer, name: e.target.value })} style={{ padding: '8px' }} />
                                <input placeholder="Roll No" required value={editingPlayer.rollNo} onChange={e => setEditingPlayer({ ...editingPlayer, rollNo: e.target.value })} style={{ padding: '8px' }} />
                                <input placeholder="Course / Year" required value={editingPlayer.course} onChange={e => setEditingPlayer({ ...editingPlayer, course: e.target.value })} style={{ padding: '8px' }} />
                                <input placeholder="Role (e.g. Batsman, Right-arm Fast)" required value={editingPlayer.role} onChange={e => setEditingPlayer({ ...editingPlayer, role: e.target.value })} style={{ padding: '8px' }} />
                                <input placeholder="Base Price (Lakhs)" type="number" required value={editingPlayer.basePrice} onChange={e => setEditingPlayer({ ...editingPlayer, basePrice: parseInt(e.target.value) || 100 })} style={{ padding: '8px' }} />
                                <div style={{ gridColumn: 'span 2', display: 'flex', gap: '10px' }}>
                                    <button type="submit" className="btn btn-primary">Save Player</button>
                                    <button type="button" className="btn btn-secondary" onClick={() => setEditingPlayer(null)}>Cancel</button>
                                </div>
                            </form>
                        </div>
                    )}

                    <div className="glass-card">
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                                <tr style={{ textAlign: 'left', borderBottom: '1px solid #555' }}>
                                    <th style={{ padding: '10px' }}>
                                        <input
                                            type="checkbox"
                                            onChange={toggleSelectAll}
                                            checked={players.length > 0 && selectedPlayerIds.length === players.length}
                                            style={{ transform: 'scale(1.3)', cursor: 'pointer' }}
                                        />
                                    </th>
                                    <th style={{ padding: '10px' }}>Name</th>
                                    <th>Roll No</th>
                                    <th>Course</th>
                                    <th>Role</th>
                                    <th>Base Price</th>
                                    <th>Status</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {players.filter(p => (p.name || '').toLowerCase().includes(searchTerm.toLowerCase()) || (p.role || '').toLowerCase().includes(searchTerm.toLowerCase())).map(p => (
                                    <tr key={p.id} style={{ borderBottom: '1px solid #333' }}>
                                        <td style={{ padding: '10px' }}>
                                            <input
                                                type="checkbox"
                                                checked={selectedPlayerIds.includes(p.id)}
                                                onChange={() => toggleSelectPlayer(p.id)}
                                                style={{ transform: 'scale(1.3)', cursor: 'pointer' }}
                                            />
                                        </td>
                                        <td style={{ padding: '10px', fontWeight: 'bold' }}>{p.name}</td>
                                        <td>{p.rollNo}</td>
                                        <td>{p.course}</td>
                                        <td><span className="badge badge-secondary">{p.role}</span></td>
                                        <td>₹{p.basePrice} L</td>
                                        <td>
                                            {p.status === 'uncapped' && <span className="badge badge-secondary">Unsold</span>}
                                            {p.status === 'unsold' && <span className="badge badge-danger">Unsold</span>}
                                            {p.status === 'sold' && (
                                                <span className="badge badge-success">
                                                    Sold to {teams.find(t => t.id === p.teamId)?.name || 'Unknown'} (₹{p.soldPrice}L)
                                                </span>
                                            )}
                                            {p.status === 'captain' && (
                                                <span className="badge badge-warning" style={{ color: 'black', background: 'gold' }}>
                                                    👑 Captain ({teams.find(t => t.id === p.teamId)?.name || 'Unknown'})
                                                </span>
                                            )}
                                        </td>
                                        <td>
                                            <button onClick={() => setEditingPlayer(p)} style={{ marginRight: '5px', cursor: 'pointer' }}>✏️</button>
                                            <button onClick={() => handleDeletePlayer(p.id)} style={{ cursor: 'pointer', color: 'red', marginRight: '5px' }}>🗑️</button>
                                            {p.status === 'sold' && (
                                                <button onClick={() => handleMarkUnsold(p.id)} style={{ cursor: 'pointer', fontSize: '0.8rem', background: '#444', color: 'white', border: 'none', padding: '2px 5px', borderRadius: '3px' }}>
                                                    ↺ Unsold
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* === TEAMS LIST TAB === */}
            {activeTab === 'teams' && (
                <div className="container">
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '20px' }}>
                        <button className="btn btn-primary" onClick={downloadCSV}>
                            📥 Export Team Data (CSV)
                        </button>
                    </div>
                    <div className="glass-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '20px' }}>
                        {teams.map(team => {
                            const teamPlayers = players.filter(p => p.teamId === team.id);
                            const captain = teamPlayers.find(p => p.status === 'captain');
                            return (
                                <div key={team.id} className="glass-card">
                                    <h3 style={{ borderBottom: '1px solid #444', paddingBottom: '10px', marginBottom: '10px', display: 'flex', justifyContent: 'space-between' }}>
                                        {team.name}
                                        <span style={{ fontSize: '0.8rem', color: '#aaa' }}>
                                            {teamPlayers.length}/{team.maxSlots || 15}
                                        </span>
                                    </h3>
                                    {captain && (
                                        <div style={{ padding: '8px', background: 'rgba(255, 215, 0, 0.1)', border: '1px solid rgba(255, 215, 0, 0.3)', borderRadius: '5px', marginBottom: '10px', color: '#ffd700' }}>
                                            <strong>👑 Captain:</strong> {captain.name}
                                        </div>
                                    )}
                                    <ul style={{ listStyle: 'none', padding: 0 }}>
                                        {teamPlayers.filter(p => p.status !== 'captain').map(p => (
                                            <li key={p.id} style={{ padding: '5px 0', borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', justifyContent: 'space-between' }}>
                                                <span>{p.name} ({p.role})</span>
                                                <span style={{ color: 'var(--primary)', fontWeight: 'bold' }}>₹{p.soldPrice}L</span>
                                            </li>
                                        ))}
                                        {teamPlayers.length === 0 && <li style={{ color: '#666', fontStyle: 'italic' }}>No players yet</li>}
                                    </ul>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
}

export default AdminPanel;
