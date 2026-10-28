'use strict';
// Poison Chips — a tiny, dependency-free HTTP + WebSocket game server.
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');

const PORT = Number(process.env.PORT || 3000);
const CHIPS = 20;
const MAX_ROUNDS = 3;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const rooms = new Map();
const publicDir = path.join(__dirname, 'public');

function roomCode() {
  let code;
  do { code = Array.from(crypto.randomBytes(6), n => ALPHABET[n % ALPHABET.length]).join(''); }
  while (rooms.has(code));
  return code;
}
function cleanName(raw) {
  return typeof raw === 'string' ? [...raw.trim().replace(/[<>\r\n\t]/g, '')].slice(0, 12).join('') : '';
}
function safeId(id) { return typeof id === 'string' && /^[a-zA-Z0-9_-]{16,100}$/.test(id); }
function sendError(peer, message) { peer.send({ type: 'error', message }); }
function isWebSocketOpen(peer) { return peer && !peer.closed && !peer.socket.destroyed; }
function connected(p) { return Boolean(p && isWebSocketOpen(p.ws)); }
function newPlayer(id, name, ws) {
  return { id, name, ws, wins: 0, poison: null, nextReady: false, rematchReady: false };
}
function newRoom(creator) {
  return {
    code: roomCode(), players: [creator], status: 'lobby', phase: 'none', round: 0,
    startIndex: crypto.randomInt(0, 2), turn: null, remaining: [], removed: [],
    lastPick: null, lastResult: null, winnerId: null, history: [], lastActive: Date.now()
  };
}
function snapshot(room, viewer) {
  return {
    code: room.code, status: room.status, phase: room.phase, round: room.round,
    totalRounds: MAX_ROUNDS, chips: CHIPS, startIndex: room.startIndex,
    turnId: room.turn, remaining: room.remaining, removed: room.removed,
    lastPick: room.lastPick, lastResult: room.lastResult, winnerId: room.winnerId,
    selfId: viewer.id, selfPoison: viewer.poison,
    players: room.players.map(p => ({
      id: p.id, name: p.name, connected: connected(p), wins: p.wins,
      poisonLocked: p.poison !== null, nextReady: p.nextReady, rematchReady: p.rematchReady
    })),
    history: room.history.slice(-7)
  };
}
function broadcast(room) {
  room.lastActive = Date.now();
  for (const p of room.players) if (connected(p)) p.ws.send({ type: 'state', room: snapshot(room,p) });
}
function startRound(room) {
  room.round += 1;
  room.phase = 'plant'; room.status = 'playing';
  room.remaining = Array.from({ length: CHIPS }, (_, i) => i);
  room.removed = []; room.turn = null; room.lastPick = null; room.lastResult = null;
  room.players.forEach(p => { p.poison = null; p.nextReady = false; });
  room.history.push({ round: room.round, text: `第 ${room.round} 局开始：偷偷挑一片埋雷。` });
  broadcast(room);
}
function startMatch(room) {
  room.round = 0; room.winnerId = null;
  room.players.forEach(p => { p.wins = 0; p.rematchReady = false; });
  room.history = [];
  // Alternate who goes first between matches.
  room.startIndex = 1 - room.startIndex;
  startRound(room);
}
function endRound(room, loser, chip) {
  room.phase = 'reveal';
  const winner = room.players.find(p => p.id !== loser.id);
  winner.wins += 1;
  room.lastResult = {
    pickedChip: chip, loserId: loser.id, winnerId: winner.id,
    poisons: room.players.map(p => ({ id: p.id, chip: p.poison })),
    winnerName: winner.name, loserName: loser.name
  };
  room.history.push({ round: room.round, text: `💥 ${loser.name} 拿到了毒薯片！${winner.name} +1 胜。` });
  // Best of three; first to 2 takes the match.
  if (winner.wins >= 2 || room.round >= MAX_ROUNDS) {
    room.status = 'finished'; room.phase = 'finished'; room.winnerId = winner.id;
  }
  broadcast(room);
}
function handleMessage(peer, data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return;
  if (data.type === 'ping') return peer.send({type:'pong'});
  if (data.type === 'create' || data.type === 'join') {
    const id = data.playerId, name = cleanName(data.name);
    if (!safeId(id) || !name) return sendError(peer, '请输入昵称后再进入游戏。');
    if (peer.roomId) return sendError(peer, '你已经在一个房间里了。');
    let room, player;
    if (data.type === 'create') {
      player = newPlayer(id, name, peer);
      room = newRoom(player); rooms.set(room.code, room);
    } else {
      room = rooms.get(String(data.code || '').trim().toUpperCase());
      if (!room) return sendError(peer, '找不到这个房间，可能已经过期，请重新创建。');
      player = room.players.find(p => p.id === id);
      if (!player) {
        if (room.players.length >= 2) return sendError(peer, '房间已经满员啦。');
        player = newPlayer(id, name, peer); room.players.push(player);
      } else {
        if (connected(player) && player.ws !== peer) player.ws.close();
        player.ws = peer;
      }
    }
    peer.roomId = room.code; peer.playerId = id;
    peer.send({ type:'joined', code: room.code }); broadcast(room);
    return;
  }
  const room = rooms.get(peer.roomId);
  const player = room?.players.find(p => p.id === peer.playerId && p.ws === peer);
  if (!player) return sendError(peer, '请先创建房间或加入房间。');
  if (data.type === 'start') {
    if (room.status !== 'lobby') return;
    if (room.players[0].id !== player.id) return sendError(peer, '只有房主能开始比赛。');
    if (room.players.length !== 2 || room.players.some(p => !connected(p))) return sendError(peer, '需要两位玩家都在线才能开始。');
    startMatch(room);
  } else if (data.type === 'plant') {
    if (room.status !== 'playing' || room.phase !== 'plant' || player.poison !== null) return;
    const idx = data.chip;
    if (!Number.isInteger(idx) || idx < 0 || idx >= CHIPS) return sendError(peer, '请选择有效的薯片。');
    player.poison = idx;
    room.history.push({ round: room.round, text: `${player.name} 已经悄悄埋好雷。` });
    if (room.players.every(p => p.poison !== null)) {
      room.phase = 'pick';
      room.turn = room.players[(room.startIndex + room.round - 1) % 2].id;
      room.history.push({ round: room.round, text: '埋雷完成，开吃！' });
    }
    broadcast(room);
  } else if (data.type === 'pick') {
    if (room.status !== 'playing' || room.phase !== 'pick' || room.turn !== player.id) return;
    if (room.players.some(p => !connected(p))) return sendError(peer, '对方暂时离线，请等 TA 回来。');
    const idx = data.chip;
    if (!Number.isInteger(idx) || !room.remaining.includes(idx)) return sendError(peer, '这片薯片已经不在桌上。');
    room.remaining = room.remaining.filter(n => n !== idx);
    room.removed.push(idx);
    room.lastPick = { id: player.id, chip: idx };
    const opponent = room.players.find(p => p.id !== player.id);
    if (idx === opponent.poison) return endRound(room, player, idx);
    // Picking your own chip is safe unless both chose the same poison chip.
    room.history.push({ round: room.round, text: `${player.name} 拿走了第 ${idx+1} 片，安全！` });
    room.turn = opponent.id;
    broadcast(room);
  } else if (data.type === 'next') {
    if (room.status !== 'playing' || room.phase !== 'reveal') return;
    if (room.players[0].id !== player.id) return sendError(peer, '房主可以开启下一局。');
    if (room.players.some(p => !connected(p))) return sendError(peer, '请等两人都在线再开始下一局。');
    startRound(room);
  } else if (data.type === 'rematch') {
    if (room.status !== 'finished') return;
    player.rematchReady = true;
    if (room.players.length === 2 && room.players.every(p => p.rematchReady && connected(p))) startMatch(room);
    else broadcast(room);
  }
}

// A minimal RFC 6455 implementation for small masked browser text frames.
class Peer {
  constructor(socket) {
    this.socket = socket; this.buffer = Buffer.alloc(0); this.closed = false;
    this.roomId = null; this.playerId = null; this.timestamps = [];
    socket.on('data', chunk => this.onData(chunk));
    socket.on('close', () => this.disconnected());
    socket.on('error', () => this.disconnected());
  }
  write(opcode, payload) {
    if (!isWebSocketOpen(this)) return;
    const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
    let header;
    if (body.length <= 125) { header = Buffer.from([0x80 | opcode, body.length]); }
    else if (body.length <= 65535) { header = Buffer.alloc(4); header[0] = 0x80 | opcode; header[1] = 126; header.writeUInt16BE(body.length, 2); }
    else return;
    this.socket.write(Buffer.concat([header, body]));
  }
  send(value) { this.write(1, JSON.stringify(value)); }
  close() { if (this.closed) return; this.write(8, Buffer.alloc(0)); this.socket.end(); this.disconnected(); }
  disconnected() {
    if (this.closed) return; this.closed = true;
    const room = rooms.get(this.roomId);
    if (room) {
      const p = room.players.find(p => p.id === this.playerId);
      if (p && p.ws === this) { p.ws = null; broadcast(room); }
    }
  }
  onData(chunk) {
    if (this.closed) return;
    this.buffer = Buffer.concat([this.buffer, chunk]);
    if (this.buffer.length > 40000) return this.close();
    while (this.buffer.length >= 2) {
      const b0 = this.buffer[0], b1 = this.buffer[1];
      const opcode = b0 & 0x0f;
      if ((b0 & 0x80) === 0) return this.close(); // no continuation/fragmentation
      if (!(b1 & 0x80)) return this.close(); // browsers must mask their frames
      let pos = 2, len = b1 & 0x7f;
      if (len === 127) return this.close();
      if (len === 126) { if (this.buffer.length < 4) return; len = this.buffer.readUInt16BE(2); pos = 4; }
      if (len > 16000) return this.close();
      if (this.buffer.length < pos + 4 + len) return;
      const mask = this.buffer.subarray(pos, pos + 4); pos += 4;
      const payload = Buffer.from(this.buffer.subarray(pos, pos + len));
      this.buffer = this.buffer.subarray(pos + len);
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
      if (opcode === 8) return this.close();
      if (opcode === 9) { this.write(10, payload); continue; }
      if (opcode === 10) continue;
      if (opcode !== 1) return this.close();
      let data;
      try { data = JSON.parse(payload.toString('utf8')); } catch { continue; }
      const now = Date.now();
      this.timestamps = this.timestamps.filter(ts => now - ts < 10000);
      if (this.timestamps.length >= 30) return this.close();
      this.timestamps.push(now);
      handleMessage(this, data);
    }
  }
}

const mimeTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const server = http.createServer((req, res) => {
  if (req.url === '/health') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"ok":true}'); }
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch { res.writeHead(400); return res.end(); }
  if (pathname === '/') pathname = '/index.html';
  const abs = path.resolve(publicDir, '.' + pathname);
  if (!abs.startsWith(publicDir + path.sep)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(abs, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': mimeTypes[path.extname(abs)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    res.end(data);
  });
});
server.on('upgrade', (req, socket, head) => {
  if (req.url !== '/ws' || req.headers.upgrade?.toLowerCase() !== 'websocket' ||
      !/^[A-Za-z0-9+/]{22}==$/.test(req.headers['sec-websocket-key'] || '')) {
    socket.destroy(); return;
  }
  const accept = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  const peer = new Peer(socket);
  if (head.length) peer.onData(head);
});
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) if (now - room.lastActive > 1000 * 60 * 120 && room.players.every(p => !p.ws)) {
    clearTimer(room); rooms.delete(code);
  }
}, 1000 * 60 * 10).unref();
server.listen(PORT, '0.0.0.0', () => console.log(`POISON CHIPS listening on http://localhost:${PORT}`));
module.exports = { server, rooms };
