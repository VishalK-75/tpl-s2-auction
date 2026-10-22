import { initialAuctionState } from '../data/initialAuctionState';
import { io } from 'socket.io-client';

const STORAGE_KEY = 'tpl_auction_state_v2';
const CHANNEL_NAME = 'tpl_auction_channel';

// Determine backend URL
const SERVER_URL = import.meta.env.VITE_SERVER_URL || (
  typeof window !== 'undefined' && window.location.hostname === 'localhost'
    ? 'http://localhost:3000'
    : ''
);

let socket = null;
if (SERVER_URL) {
  try {
    socket = io(SERVER_URL, {
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 3,
      timeout: 3000
    });
  } catch (e) {
    console.warn("Socket init skipped or failed:", e);
  }
}

// BroadcastChannel for cross-tab real-time sync (Vercel Standalone Mode)
let channel = null;
if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
  channel = new BroadcastChannel(CHANNEL_NAME);
}

export const getStoredState = () => {
  if (typeof window === 'undefined') return initialAuctionState;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      // Ensure valid structure
      if (parsed && Array.isArray(parsed.players) && Array.isArray(parsed.teams)) {
        return parsed;
      }
    }
  } catch (e) {
    console.warn("Failed to read from localStorage:", e);
  }
  // Fallback to pre-loaded 47 players & teams
  localStorage.setItem(STORAGE_KEY, JSON.stringify(initialAuctionState));
  return initialAuctionState;
};

export const saveLocalState = (newState) => {
  if (typeof window === 'undefined') return newState;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newState));
  } catch (e) {
    console.warn("Failed to write to localStorage:", e);
  }
  if (channel) {
    channel.postMessage({ type: 'UPDATE', data: newState });
  }
  return newState;
};

export { socket, SERVER_URL };
