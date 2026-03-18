/**
 * TaskFlux Ultra — Dual-Device Sync Server
 * =========================================
 * Run:  node sync-server.js
 * Port: 8099 (change SYNC_PORT if needed)
 *
 * Protocol:
 *   Client → Server:  { type: 'hello', role: 'leader'|'follower' }
 *   Client → Server:  { type: 'propose', taskId: '...', fireAt: <epoch ms> }
 *   Client → Server:  { type: 'reserved', taskIds: ['id1','id2',...] }   // broadcast what I'm about to claim
 *   Server → Client:  { type: 'peer_reserved', taskIds: [...] }           // ids the OTHER device is claiming
 *   Server → Client:  { type: 'fire', taskId: '...', fireAt: <epoch ms> } // sent to follower
 *   Server → Client:  { type: 'status', msg: '...' }
 *   Server → Client:  { type: 'peer_connected' | 'peer_disconnected' }
 */

const WebSocket = require('ws');
const SYNC_PORT = process.env.PORT || 8099;

const wss = new WebSocket.Server({ port: SYNC_PORT });

let clients = {}; // role -> ws

function send(ws, obj) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

function broadcast(obj, excludeWs) {
  wss.clients.forEach(function(c) {
    if (c !== excludeWs && c.readyState === WebSocket.OPEN) {
      c.send(JSON.stringify(obj));
    }
  });
}

wss.on('connection', function(ws) {
  ws._role = null;
  console.log('[Sync] New connection');

  ws.on('message', function(raw) {
    var msg;
    try { msg = JSON.parse(raw); } catch(e) { return; }

    if (msg.type === 'hello') {
      ws._role = msg.role || 'unknown';
      clients[ws._role] = ws;
      console.log('[Sync] ' + ws._role + ' connected');
      send(ws, { type: 'status', msg: 'Connected as ' + ws._role });
      // Tell the other side a peer joined
      broadcast({ type: 'peer_connected', role: ws._role }, ws);
    }

    // Leader found a task — tell follower to fire at the same time
    else if (msg.type === 'propose') {
      console.log('[Sync] Leader proposes task ' + msg.taskId + ' fireAt ' + msg.fireAt);
      var follower = clients['follower'];
      if (follower && follower.readyState === WebSocket.OPEN) {
        send(follower, { type: 'fire', taskId: msg.taskId, fireAt: msg.fireAt });
      } else {
        // No follower — tell leader to just fire alone
        send(ws, { type: 'status', msg: 'No follower connected — firing solo' });
      }
    }

    // A device is about to claim these task IDs — tell the peer to avoid them
    else if (msg.type === 'reserved') {
      broadcast({ type: 'peer_reserved', taskIds: msg.taskIds }, ws);
    }
  });

  ws.on('close', function() {
    console.log('[Sync] ' + (ws._role || 'unknown') + ' disconnected');
    if (ws._role && clients[ws._role] === ws) {
      delete clients[ws._role];
    }
    broadcast({ type: 'peer_disconnected', role: ws._role });
  });

  ws.on('error', function(e) {
    console.error('[Sync] Error:', e.message);
  });
});

console.log('[Sync] TaskFlux sync server listening on ws://localhost:' + SYNC_PORT);
