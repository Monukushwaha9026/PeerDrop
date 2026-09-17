// server/rooms.js - Temporary Room Manager for PeerDrop with Session Resumption
import crypto from 'crypto';

class RoomManager {
  constructor(timeoutMs = 30 * 60 * 1000, gracePeriodMs = 15 * 1000) {
    // Map<roomCode, { code, host: { peerId, ws, timer }, guest: { peerId, ws, timer }, createdAt, lastActive }>
    this.rooms = new Map();
    // Map<WebSocket, roomCode>
    this.peerToRoom = new Map();
    this.timeoutMs = timeoutMs;
    this.gracePeriodMs = gracePeriodMs;
    this.onPeerLeftPermanently = null;

    // Periodic sweep for abandoned/stale rooms
    this.cleanupInterval = setInterval(() => this.cleanupStaleRooms(), 60 * 1000);
  }

  // Generates user-friendly 6-character room code: "X7K9-P2"
  generateCode() {
    const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // Exclude 0, 1, I, O to avoid confusion
    let code;
    let attempts = 0;
    do {
      let part1 = '';
      let part2 = '';
      const bytes = crypto.randomBytes(6);
      for (let i = 0; i < 4; i++) {
        part1 += chars[bytes[i] % chars.length];
      }
      for (let i = 4; i < 6; i++) {
        part2 += chars[bytes[i] % chars.length];
      }
      code = `${part1}-${part2}`;
      attempts++;
    } while (this.rooms.has(code) && attempts < 100);
    return code;
  }

  createRoom(ws, peerId = null) {
    // If peer already in a room, remove them first
    this.removePeer(ws, true);

    const code = this.generateCode();
    const pid = peerId || `p_${crypto.randomBytes(8).toString('hex')}`;
    const room = {
      code,
      host: { peerId: pid, ws, timer: null },
      guest: null,
      createdAt: Date.now(),
      lastActive: Date.now(),
      get peers() {
        const s = new Set();
        if (this.host?.ws) s.add(this.host.ws);
        if (this.guest?.ws) s.add(this.guest.ws);
        return s;
      }
    };

    this.rooms.set(code, room);
    this.peerToRoom.set(ws, code);
    console.log(`[Room] Created ${code} (host peerId: ${pid}). Total active rooms: ${this.rooms.size}`);
    return { code, peerId: pid };
  }

  joinRoom(code, ws, peerId = null) {
    const normalizedCode = (code || '').trim().toUpperCase();
    const room = this.rooms.get(normalizedCode);

    if (!room) {
      return { success: false, error: 'ROOM_NOT_FOUND', message: 'Room code does not exist or has expired.' };
    }

    // If this socket is already known as host
    if (room.host && room.host.ws === ws) {
      return { success: true, code: normalizedCode, role: 'host', peerId: room.host.peerId };
    }

    // If this socket is already known as guest
    if (room.guest && room.guest.ws === ws) {
      return { success: true, code: normalizedCode, role: 'guest', peerId: room.guest.peerId, otherPeer: room.host?.ws };
    }

    // Check if there is already an active guest with a live connection that is NOT us
    if (room.guest && room.guest.ws && room.guest.ws !== ws && room.guest.ws.readyState === 1) {
      return { success: false, error: 'ROOM_FULL', message: 'Room is full. Maximum 2 devices allowed.' };
    }

    // Leave any existing room
    this.removePeer(ws, true);

    const pid = peerId || (room.guest?.peerId || `p_${crypto.randomBytes(8).toString('hex')}`);
    if (room.guest?.timer) {
      clearTimeout(room.guest.timer);
    }

    room.guest = { peerId: pid, ws, timer: null };
    room.lastActive = Date.now();
    this.peerToRoom.set(ws, normalizedCode);

    console.log(`[Room] Peer joined ${normalizedCode} as guest (peerId: ${pid}).`);

    // Return the other peer so signaling can notify them
    const otherPeer = (room.host?.ws && room.host.ws.readyState === 1) ? room.host.ws : null;
    return { success: true, code: normalizedCode, role: 'guest', peerId: pid, otherPeer };
  }

  reconnectPeer(code, peerId, ws, role = null) {
    const normalizedCode = (code || '').trim().toUpperCase();
    const room = this.rooms.get(normalizedCode);

    if (!room) {
      return { success: false, error: 'ROOM_NOT_FOUND', message: 'Room code does not exist or has expired.' };
    }

    let matchedRole = null;
    if (role === 'host' || (!role && room.host?.peerId === peerId)) {
      if (room.host && (room.host.peerId === peerId || !peerId)) {
        matchedRole = 'host';
      }
    } else if (role === 'guest' || (!role && room.guest?.peerId === peerId)) {
      if (room.guest && (room.guest.peerId === peerId || !peerId)) {
        matchedRole = 'guest';
      }
    }

    // Fallback: match by peerId if provided
    if (!matchedRole && peerId) {
      if (room.host?.peerId === peerId) matchedRole = 'host';
      else if (room.guest?.peerId === peerId) matchedRole = 'guest';
    }

    if (!matchedRole) {
      return { success: false, error: 'SESSION_INVALID', message: 'Previous session not found in room.' };
    }

    const slot = matchedRole === 'host' ? room.host : room.guest;
    if (slot.timer) {
      clearTimeout(slot.timer);
      slot.timer = null;
    }

    if (slot.ws && slot.ws !== ws) {
      this.peerToRoom.delete(slot.ws);
    }

    slot.ws = ws;
    if (peerId) slot.peerId = peerId;
    this.peerToRoom.set(ws, normalizedCode);
    room.lastActive = Date.now();

    const otherPeer = matchedRole === 'host' ? room.guest?.ws : room.host?.ws;
    console.log(`[Room] Session reconnected for ${normalizedCode} as ${matchedRole} (peerId: ${slot.peerId})`);

    return {
      success: true,
      code: normalizedCode,
      role: matchedRole,
      peerId: slot.peerId,
      otherPeer: (otherPeer && otherPeer.readyState === 1) ? otherPeer : null
    };
  }

  getOtherPeer(ws) {
    const code = this.peerToRoom.get(ws);
    if (!code) return null;
    const room = this.rooms.get(code);
    if (!room) return null;

    if (room.host?.ws === ws) {
      return (room.guest?.ws && room.guest.ws.readyState === 1) ? room.guest.ws : null;
    }
    if (room.guest?.ws === ws) {
      return (room.host?.ws && room.host.ws.readyState === 1) ? room.host.ws : null;
    }
    return null;
  }

  getRoomCode(ws) {
    return this.peerToRoom.get(ws) || null;
  }

  removePeer(ws, isExplicitLeave = false) {
    const code = this.peerToRoom.get(ws);
    if (!code) return null;

    const room = this.rooms.get(code);
    if (!room) {
      this.peerToRoom.delete(ws);
      return null;
    }

    const isHost = room.host?.ws === ws;
    const isGuest = room.guest?.ws === ws;
    if (!isHost && !isGuest) {
      this.peerToRoom.delete(ws);
      return null;
    }

    this.peerToRoom.delete(ws);
    const slot = isHost ? room.host : room.guest;
    slot.ws = null;

    const otherSlot = isHost ? room.guest : room.host;
    const remainingPeer = (otherSlot?.ws && otherSlot.ws.readyState === 1) ? otherSlot.ws : null;

    if (isExplicitLeave) {
      if (slot.timer) clearTimeout(slot.timer);
      if (isHost) room.host = null;
      if (isGuest) room.guest = null;

      if (isHost || (!room.host && !room.guest) || (!room.host?.ws && !room.guest?.ws && !room.host?.timer && !room.guest?.timer)) {
        this.rooms.delete(code);
        console.log(`[Room] Destroyed room ${code} on explicit departure.`);
        return { code, remainingPeer, roomDestroyed: true, temporary: false };
      }

      console.log(`[Room] Guest left ${code} explicitly.`);
      return { code, remainingPeer, roomDestroyed: false, temporary: false };
    }

    // Unexpected disconnect (page refresh, network drop) -> start grace timer
    console.log(`[Room] Peer in ${code} (${isHost ? 'host' : 'guest'}) disconnected unexpectedly. Starting ${this.gracePeriodMs}ms grace timer.`);
    if (slot.timer) clearTimeout(slot.timer);

    slot.timer = setTimeout(() => {
      console.log(`[Room] Grace period expired for ${code} (${isHost ? 'host' : 'guest'}).`);
      slot.timer = null;
      if (isHost) room.host = null;
      if (isGuest) room.guest = null;

      const stillConnected = (room.host?.ws && room.host.ws.readyState === 1) || 
                             (room.guest?.ws && room.guest.ws.readyState === 1) ||
                             room.host?.timer || room.guest?.timer;

      if (!stillConnected) {
        this.rooms.delete(code);
        console.log(`[Room] Expired room ${code} deleted.`);
      } else if (remainingPeer) {
        if (typeof this.onPeerLeftPermanently === 'function') {
          this.onPeerLeftPermanently(remainingPeer, code);
        }
      }
    }, this.gracePeriodMs);

    return { code, remainingPeer, temporary: true, roomDestroyed: false };
  }

  cleanupStaleRooms() {
    const now = Date.now();
    for (const [code, room] of this.rooms.entries()) {
      if (now - room.lastActive > this.timeoutMs) {
        console.log(`[Room] Expiring inactive room ${code}`);
        const peers = [room.host?.ws, room.guest?.ws].filter(Boolean);
        for (const peer of peers) {
          this.peerToRoom.delete(peer);
          try {
            peer.send(JSON.stringify({ type: 'error', message: 'Room expired due to inactivity.' }));
          } catch (_) {}
        }
        if (room.host?.timer) clearTimeout(room.host.timer);
        if (room.guest?.timer) clearTimeout(room.guest.timer);
        this.rooms.delete(code);
      }
    }
  }

  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    for (const room of this.rooms.values()) {
      if (room.host?.timer) clearTimeout(room.host.timer);
      if (room.guest?.timer) clearTimeout(room.guest.timer);
    }
    this.rooms.clear();
    this.peerToRoom.clear();
  }
}

export const roomManager = new RoomManager();
