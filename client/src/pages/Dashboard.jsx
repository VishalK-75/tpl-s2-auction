import React, { useEffect, useState } from 'react';
import { socket, SERVER_URL, getStoredState, saveLocalState } from '../utils/auctionSync';

const SQUAD_SIZE = 12;

function Dashboard() {
    const [data, setData] = useState(() => getStoredState());
    const [isConnected, setIsConnected] = useState(socket ? socket.connected : false);
    const [activeTab, setActiveTab] = useState('auction');

    // --- Team Colors & State ---
    const [teamTab, setTeamTab] = useState(null);

    const teams = data ? data.teams : [];

    // Ensure teamTab is valid if teams change
    useEffect(() => {
        if (teams.length > 0 && !teamTab) {
            setTeamTab(teams[0].id);
        } else if (teamTab && !teams.find(t => t.id === teamTab)) {
            if (teams.length > 0) setTeamTab(teams[0].id);
        }
    }, [teams, teamTab]);

    const TEAM_COLORS = {
        0: 'linear-gradient(135deg, #FF416C 0%, #FF4B2B 100%)',   // Red/Orange
        1: 'linear-gradient(135deg, #1CB5E0 0%, #000851 100%)',   // Blue/Dark Blue
        2: 'linear-gradient(135deg, #000000 0%, #434343 50%, #C0C0C0 100%)',   // Black/Silver
        3: 'linear-gradient(135deg, #8E2DE2 0%, #4A00E0 100%)',   // Purple/Violet
        4: 'linear-gradient(135deg, #FFD200 0%, #F7971E 100%)',   // Yellow/Orange
    };

    const getTeamColor = (index) => TEAM_COLORS[index % 5];

    useEffect(() => {
        // 1. Cross-tab real-time broadcast channel
        let channel = null;
        if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
            channel = new BroadcastChannel('tpl_auction_channel');
            channel.onmessage = (event) => {
                if (event.data && event.data.type === 'UPDATE' && event.data.data) {
                    setData(event.data.data);
                }
            };
        }

        // 2. Storage event listener (fallback cross-window)
        const handleStorage = (e) => {
            if (e.key === 'tpl_auction_state_v2' && e.newValue) {
                try {
                    setData(JSON.parse(e.newValue));
                } catch (err) {
                    console.error("Storage parse error", err);
                }
            }
        };
        window.addEventListener('storage', handleStorage);

        // 3. Socket / Server sync if available
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

            // Try initial fetch
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
                        // Backend not reachable, stay on local stored state
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

    if (!data) {
        return (
            <div className="container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
                <h1>Connecting to Auction...</h1>
            </div>
        );
    }

    const { players = [], currentAuction = { playerId: null, currentBid: 0, currentTeamId: null, history: [] } } = data;
    const currentPlayer = currentAuction.playerId
        ? players.find(p => p.id === currentAuction.playerId)
        : null;

    const currentTeam = currentAuction.currentTeamId
        ? teams.find(t => t.id === currentAuction.currentTeamId)
        : null;

    const soldPlayers = players.filter(p => p.status === 'sold');
    const unsoldPlayers = players.filter(p => p.status === 'unsold' || p.status === 'uncapped');

    return (
        <div className="container">
            <header>
                <div className="logo">TPL 2026 AUCTION</div>
                <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
                    <nav style={{ display: 'flex', gap: '10px' }}>
                        <button
                            onClick={() => setActiveTab('auction')}
                            style={{
                                background: activeTab === 'auction' ? 'var(--primary)' : 'transparent',
                                color: activeTab === 'auction' ? 'black' : 'white',
                                border: '1px solid var(--primary)',
                                padding: '5px 15px',
                                borderRadius: '20px',
                                cursor: 'pointer',
                                textTransform: 'capitalize'
                            }}
                        >
                            🔨 Auction
                        </button>
                        <button
                            onClick={() => setActiveTab('sold')}
                            style={{
                                background: activeTab === 'sold' ? 'var(--primary)' : 'transparent',
                                color: activeTab === 'sold' ? 'black' : 'white',
                                border: '1px solid var(--primary)',
                                padding: '5px 15px',
                                borderRadius: '20px',
                                cursor: 'pointer',
                                textTransform: 'capitalize'
                            }}
                        >
                            💰 Sold
                        </button>
                        <button
                            onClick={() => setActiveTab('unsold')}
                            style={{
                                background: activeTab === 'unsold' ? 'var(--primary)' : 'transparent',
                                color: activeTab === 'unsold' ? 'black' : 'white',
                                border: '1px solid var(--primary)',
                                padding: '5px 15px',
                                borderRadius: '20px',
                                cursor: 'pointer',
                                textTransform: 'capitalize'
                            }}
                        >
                            ⏳ Unsold
                        </button>
                        <button
                            onClick={() => setActiveTab('teams')}
                            style={{
                                background: activeTab === 'teams' ? 'var(--primary)' : 'transparent',
                                color: activeTab === 'teams' ? 'black' : 'white',
                                border: '1px solid var(--primary)',
                                padding: '5px 15px',
                                borderRadius: '20px',
                                cursor: 'pointer',
                                textTransform: 'capitalize'
                            }}
                        >
                            👥 Teams
                        </button>
                    </nav>
                    <div style={{ fontSize: '0.8rem', color: isConnected ? 'var(--primary)' : '#00e5ff' }}>
                        ● {isConnected ? 'Live (Server)' : 'Live (Vercel Sync)'}
                    </div>
                </div>
            </header>

            {activeTab === 'auction' && (
                <div className="auction-grid">
                    {/* Left: Main Auction Area */}
                    <div className="glass-card">
                        {currentPlayer ? (
                            <div className="player-spotlight">
                                <div className="player-info" style={{ width: '100%', textAlign: 'center' }}>
                                    <span className="role-badge" style={{ fontSize: '1.2rem', padding: '10px 20px' }}>{currentPlayer.role}</span>
                                    <h1 style={{ fontSize: '4rem', marginTop: '20px' }}>{currentPlayer.name}</h1>
                                    <div style={{ display: 'flex', justifyContent: 'center', gap: '30px', margin: '20px 0', fontSize: '1.2rem', color: '#ccc' }}>
                                        <span>Roll No: <strong style={{ color: 'white' }}>{currentPlayer.rollNo}</strong></span>
                                        <span>Course: <strong style={{ color: 'white' }}>{currentPlayer.course}</strong></span>
                                    </div>
                                    <p style={{ fontSize: '1.5rem' }}>Base Price: ₹{currentPlayer.basePrice} Lakhs</p>

                                    <div className="bid-status">
                                        <div>Current Bid</div>
                                        <div className="current-bid" style={{ fontSize: '5rem' }}>₹{currentAuction.currentBid} L</div>
                                        {currentTeam && (
                                            <div className="holding-team">Held by {currentTeam.name}</div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div style={{ textAlign: 'center', padding: '100px 0' }}>
                                <h1>Waiting for next player...</h1>
                                <p>The auctioneer is selecting the next player.</p>
                            </div>
                        )}
                    </div>

                    {/* Right: Team Standings */}
                    <div className="glass-card teams-list">
                        <h2>Team Standings</h2>
                        {teams.map((team, idx) => {
                            // Max Bid Logic
                            const MIN_BASE_PRICE = 100;
                            const filledSlots = (team.players || []).length;
                            const minSlots = team.minSlots || 12;
                            const maxSlots = team.maxSlots || 15;
                            const remainingSlotsToMin = minSlots - filledSlots;
                            let maxBid = 0;

                            if (filledSlots < maxSlots) {
                                let slotsToReserve = 0;
                                if (remainingSlotsToMin > 0) {
                                    slotsToReserve = remainingSlotsToMin - 1;
                                }
                                if (slotsToReserve < 0) slotsToReserve = 0;

                                const reservedAmount = slotsToReserve * MIN_BASE_PRICE;
                                const currentPurse = team.budget - team.spent;
                                const potentialMax = currentPurse - reservedAmount;
                                maxBid = potentialMax > 0 ? potentialMax : 0;
                            }

                            return (
                                <div key={team.id} className="team-card" style={{ borderLeft: `5px solid`, borderImageSource: getTeamColor(idx), borderImageSlice: 1 }}>
                                    <div>
                                        <div className="team-name" style={{ color: 'white' }}>{team.name}</div>
                                        <div className="players-count">{(team.players || []).length} / {maxSlots} (Min {minSlots})</div>
                                    </div>
                                    <div className="team-stats">
                                        <div className="purse">₹{team.budget - team.spent} L</div>
                                        <div style={{ fontSize: '0.8rem', opacity: 0.7 }}>Rem. Purse</div>
                                        <div style={{ fontSize: '0.9rem', color: 'var(--secondary)', marginTop: '5px', fontWeight: 'bold' }}>
                                            Max Bid: ₹{maxBid}L
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {activeTab === 'sold' && (
                <div className="glass-card">
                    <h2>Sold Players ({soldPlayers.length})</h2>
                    <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '20px' }}>
                        <thead>
                            <tr style={{ textAlign: 'left', borderBottom: '1px solid #444' }}>
                                <th style={{ padding: '10px' }}>Name</th>
                                <th>Role</th>
                                <th>Course</th>
                                <th>Team</th>
                                <th>Sold Price</th>
                            </tr>
                        </thead>
                        <tbody>
                            {soldPlayers.map(p => (
                                <tr key={p.id} style={{ borderBottom: '1px solid #333' }}>
                                    <td style={{ padding: '10px' }}>{p.name}</td>
                                    <td>{p.role}</td>
                                    <td>{p.course}</td>
                                    <td>{teams.find(t => t.id === p.teamId)?.name || 'Unknown'}</td>
                                    <td style={{ color: 'var(--primary)', fontWeight: 'bold' }}>₹{p.soldPrice} L</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {activeTab === 'unsold' && (
                <div className="glass-card">
                    <h2>Unsold / Upcoming Players ({unsoldPlayers.length})</h2>
                    <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '20px' }}>
                        <thead>
                            <tr style={{ textAlign: 'left', borderBottom: '1px solid #444' }}>
                                <th style={{ padding: '10px' }}>Name</th>
                                <th>Role</th>
                                <th>Course</th>
                                <th>Base Price</th>
                                <th>Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            {unsoldPlayers.map(p => (
                                <tr key={p.id} style={{ borderBottom: '1px solid #333' }}>
                                    <td style={{ padding: '10px' }}>{p.name}</td>
                                    <td>{p.role}</td>
                                    <td>{p.course}</td>
                                    <td>₹{p.basePrice} L</td>
                                    <td>
                                        <span className={`badge ${p.status === 'unsold' ? 'badge-danger' : 'badge-secondary'}`}>
                                            {p.status}
                                        </span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {activeTab === 'teams' && (
                <div className="glass-card">
                    <h2>Teams Squads</h2>
                    {/* Team Selection Tabs */}
                    <div style={{ display: 'flex', gap: '10px', margin: '20px 0', overflowX: 'auto', paddingBottom: '10px' }}>
                        {teams.map((t, idx) => (
                            <button
                                key={t.id}
                                onClick={() => setTeamTab(t.id)}
                                style={{
                                    background: teamTab === t.id ? 'white' : 'rgba(255,255,255,0.05)',
                                    color: teamTab === t.id ? 'black' : 'white',
                                    border: 'none',
                                    padding: '10px 20px',
                                    borderRadius: '8px',
                                    cursor: 'pointer',
                                    fontWeight: 'bold',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                    transition: 'all 0.2s',
                                    boxShadow: teamTab === t.id ? '0 4px 12px rgba(0,0,0,0.5)' : 'none'
                                }}
                            >
                                <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: getTeamColor(idx) }}></span>
                                {t.name} ({(t.players || []).length})
                            </button>
                        ))}
                    </div>

                    {/* Active Team Squad View */}
                    {(() => {
                        const activeTeam = teams.find(t => t.id === teamTab);
                        if (!activeTeam) return null;

                        const teamIdx = teams.findIndex(t => t.id === activeTeam.id);
                        const teamPlayers = players.filter(p => p.teamId === activeTeam.id);
                        const captain = teamPlayers.find(p => p.status === 'captain');
                        const normalPlayers = teamPlayers.filter(p => p.status !== 'captain');

                        return (
                            <div style={{ background: 'rgba(0,0,0,0.2)', padding: '20px', borderRadius: '12px', borderLeft: `6px solid`, borderImageSource: getTeamColor(teamIdx), borderImageSlice: 1 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', borderBottom: '1px solid #444', paddingBottom: '10px' }}>
                                    <div>
                                        <h3 style={{ fontSize: '1.8rem', margin: 0, color: 'white' }}>{activeTeam.name}</h3>
                                        <div style={{ color: '#aaa', fontSize: '0.9rem', marginTop: '5px' }}>
                                            Players: {teamPlayers.length} / {activeTeam.maxSlots || 15} (Min {activeTeam.minSlots || 12})
                                        </div>
                                    </div>
                                    <div style={{ textAlign: 'right' }}>
                                        <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'var(--primary)' }}>₹{activeTeam.budget - activeTeam.spent} L</div>
                                        <div style={{ fontSize: '0.8rem', color: '#aaa' }}>Remaining Purse (of ₹{activeTeam.budget}L)</div>
                                    </div>
                                </div>

                                {captain && (
                                    <div style={{
                                        background: 'linear-gradient(90deg, rgba(255, 215, 0, 0.15) 0%, rgba(0,0,0,0) 100%)',
                                        border: '1px solid rgba(255, 215, 0, 0.4)',
                                        padding: '12px 20px',
                                        borderRadius: '8px',
                                        marginBottom: '20px',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'space-between'
                                    }}>
                                        <div>
                                            <span style={{ background: 'gold', color: 'black', padding: '2px 8px', borderRadius: '4px', fontWeight: 'bold', fontSize: '0.8rem', marginRight: '10px' }}>CAPTAIN</span>
                                            <strong style={{ fontSize: '1.2rem', color: '#ffd700' }}>{captain.name}</strong>
                                            <span style={{ color: '#ccc', marginLeft: '10px' }}>({captain.role})</span>
                                        </div>
                                        <div style={{ color: '#aaa' }}>Retained / Icon</div>
                                    </div>
                                )}

                                <h4>Squad Members ({normalPlayers.length})</h4>
                                {normalPlayers.length === 0 ? (
                                    <p style={{ color: '#666', fontStyle: 'italic', padding: '20px 0' }}>No auctioned players yet.</p>
                                ) : (
                                    <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '10px' }}>
                                        <thead>
                                            <tr style={{ textAlign: 'left', borderBottom: '1px solid #444', color: '#888' }}>
                                                <th style={{ padding: '8px' }}>Player</th>
                                                <th>Role</th>
                                                <th>Course</th>
                                                <th>Roll No</th>
                                                <th style={{ textAlign: 'right' }}>Price</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {normalPlayers.map(p => (
                                                <tr key={p.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                                                    <td style={{ padding: '10px 8px', fontWeight: '500' }}>{p.name}</td>
                                                    <td><span className="badge badge-secondary" style={{ fontSize: '0.75rem' }}>{p.role}</span></td>
                                                    <td>{p.course}</td>
                                                    <td>{p.rollNo}</td>
                                                    <td style={{ textAlign: 'right', color: 'var(--primary)', fontWeight: 'bold' }}>₹{p.soldPrice} L</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                )}
                            </div>
                        );
                    })()}
                </div>
            )}
        </div>
    );
}

export default Dashboard;
