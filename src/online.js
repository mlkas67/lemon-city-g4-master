import Peer from 'peerjs';

const ID_PREFIX = 'lcg4-';

export function cleanUsername(raw) {
  return String(raw || '').trim().replace(/\s+/g, ' ').slice(0, 16);
}

export function usernameKey(raw) {
  return cleanUsername(raw).toLowerCase().replace(/[^a-z0-9_]/g, '');
}

export function peerIdFor(raw) {
  const key = usernameKey(raw) || 'rider';
  return `${ID_PREFIX}${key.slice(0, 20)}`;
}

/*
 * Small PeerJS session layer. Hosts keep a stable peer id derived from their
 * username so friends can find them; a host relays everyone's state at 10 Hz.
 */
export class OnlineSession {
  constructor(handlers = {}) {
    this.handlers = handlers;
    this.peer = null;
    this.id = '';
    this.username = '';
    this.status = 'offline';
    this.connections = new Map();
    this.pending = new Map();
    this.seen = new WeakSet();
    this.isHost = false;
    this.hostId = '';
    this.hostConn = null;
    this.session = null;
    this.hostInvite = null;
    this.playerStates = new Map();
    this.hostState = null;
    this.lastSnapshot = 0;
    this.sessionMembers = new Map();
  }

  connect(username) {
    this.disconnect();
    this.username = cleanUsername(username);
    this.id = peerIdFor(this.username);

    return new Promise((resolve, reject) => {
      let settled = false;
      const peer = new Peer(this.id, { debug: 0 });
      this.peer = peer;
      this._setStatus('connecting');

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        this._setStatus('offline');
        reject(new Error('Could not reach the online service. Check your connection.'));
      }, 10000);

      peer.on('open', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this._setStatus('online');
        resolve(this.id);
      });

      peer.on('connection', (conn) => this._attach(conn));

      peer.on('error', (err) => {
        const type = err && err.type;
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          this._setStatus('offline');
          reject(new Error(type === 'unavailable-id'
            ? 'That username is already online. Pick another one.'
            : 'Could not connect to the online service.'));
        } else if (type !== 'peer-unavailable') {
          this._setStatus('error');
        }
      });

      peer.on('disconnected', () => {
        this._setStatus('reconnecting');
        try { peer.reconnect(); } catch { /* peer is gone */ }
      });
      peer.on('close', () => this._setStatus('offline'));
    });
  }

  disconnect() {
    for (const conn of this.connections.values()) {
      try { conn.close(); } catch { /* already closed */ }
    }
    this.connections.clear();
    this.pending.clear();
    if (this.peer) {
      try { this.peer.destroy(); } catch { /* already destroyed */ }
    }
    this.peer = null;
    this.id = '';
    this.status = 'offline';
    this.isHost = false;
    this.hostConn = null;
    this.session = null;
    this.hostInvite = null;
    this.playerStates.clear();
    this.hostState = null;
    this.sessionMembers.clear();
  }

  _setStatus(status) {
    this.status = status;
    this.handlers.onStatus?.(status);
  }

  _send(conn, payload) {
    if (!conn || !conn.open) return false;
    try { conn.send(payload); return true; } catch { return false; }
  }

  _attach(conn) {
    if (!conn || this.seen.has(conn)) return;
    this.seen.add(conn);
    const meta = conn.metadata || {};
    if (meta.from) this.connections.set(conn.peer, conn);

    conn.on('open', () => {
      if (meta.role === 'probe') this._send(conn, { t: 'probe', name: this.username });
    });
    conn.on('data', (data) => this._receive(conn, data));
    conn.on('close', () => {
      if (this.connections.get(conn.peer) === conn) this.connections.delete(conn.peer);
      if (this.isHost && this.session && this.sessionMembers.has(conn.peer)) {
        this.sessionMembers.delete(conn.peer);
        this.playerStates.delete(conn.peer);
        this.handlers.onPlayerLeft?.(conn.peer);
        this._broadcastSnapshot(true);
      }
      if (!this.isHost && this.hostConn === conn) {
        this.hostConn = null;
        if (this.session) this.handlers.onSessionEnd?.('The host left the city.');
      }
    });
    conn.on('error', () => { /* close handles cleanup */ });
  }

  _receive(conn, data) {
    if (!data || typeof data !== 'object') return;
    switch (data.t) {
      case 'probe':
        // Presence probes stay open so a later invite can reuse the connection.
        this._send(conn, { t: 'probe-ok', name: this.username });
        break;
      case 'probe-ok':
        conn._probeOk = true;
        this.pending.get(conn.peer)?.resolve(true);
        break;
      case 'invite':
        this.hostConn = conn;
        this.hostId = conn.peer;
        this.handlers.onInvite?.({
          conn,
          from: String(data.from || 'A rider'),
          sessionId: data.sessionId,
          hostId: conn.peer,
          partySize: data.partySize || 1,
        });
        break;
      case 'vote':
        if (this.isHost && this.hostInvite) {
          const entry = this.hostInvite.invited.get(conn.peer);
          if (entry) {
            entry.voted = true;
            entry.choice = data.choice === 'race' ? 'race' : 'city';
            this._emitVotes();
          }
        }
        break;
      case 'session-start':
        if (!this.isHost) {
          this.session = data;
          this.hostConn = conn;
          this.hostId = conn.peer;
          this.handlers.onSessionStart?.(data);
        }
        break;
      case 'state':
        if (this.isHost && this.session) {
          if (data.state && data.state.id) {
            this.playerStates.set(data.state.id, data.state);
            const member = this.sessionMembers.get(data.state.id);
            if (member) member.name = data.state.name || member.name;
          }
          const now = performance.now();
          if (now - this.lastSnapshot > 90) this._broadcastSnapshot();
        }
        break;
      case 'snapshot':
        if (!this.isHost) this.handlers.onSnapshot?.(data.states || []);
        break;
      case 'session-end':
        if (!this.isHost) {
          this.session = null;
          this.hostConn = null;
          this.handlers.onSessionEnd?.(String(data.reason || 'The host ended the session.'));
        }
        break;
      case 'leave':
        if (this.isHost && this.hostInvite && this.hostInvite.invited.has(conn.peer)) {
          this.hostInvite.invited.delete(conn.peer);
          this.connections.delete(conn.peer);
          this._emitVotes();
          if (this.hostInvite.invited.size === 0) {
            this.cancelInvite('Everyone declined the invite.');
          }
          break;
        }
        if (this.isHost && this.sessionMembers.has(conn.peer)) {
          this.sessionMembers.delete(conn.peer);
          this.playerStates.delete(conn.peer);
          this.handlers.onPlayerLeft?.(conn.peer);
          this._broadcastSnapshot(true);
        }
        break;
      default:
        break;
    }
  }

  _openConnection(peerId, metadata, timeout = 7000) {
    if (!this.peer || this.peer.destroyed) return Promise.reject(new Error('Not online.'));
    if (peerId === this.id) return Promise.reject(new Error('That is your own username.'));
    const existing = this.connections.get(peerId);
    if (existing && existing.open) return Promise.resolve(existing);
    if (this.pending.has(peerId)) return this.pending.get(peerId).promise;

    let resolveFn;
    let rejectFn;
    const promise = new Promise((resolve, reject) => { resolveFn = resolve; rejectFn = reject; });
    const entry = { promise, resolve: resolveFn, reject: rejectFn, conn: null };
    this.pending.set(peerId, entry);

    let conn;
    try {
      conn = this.peer.connect(peerId, { reliable: true, serialization: 'json', metadata });
    } catch {
      this.pending.delete(peerId);
      return Promise.reject(new Error('Could not connect.'));
    }
    entry.conn = conn;
    this._attach(conn);
    const timer = setTimeout(() => {
      if (!this.pending.has(peerId)) return;
      this.pending.delete(peerId);
      try { conn.close(); } catch { /* ignore */ }
      rejectFn(new Error('offline'));
    }, timeout);
    conn.on('open', () => {
      clearTimeout(timer);
      if (!this.pending.has(peerId)) return;
      this.pending.delete(peerId);
      this.connections.set(peerId, conn);
      resolveFn(conn);
    });
    conn.on('error', (err) => {
      clearTimeout(timer);
      if (!this.pending.has(peerId)) return;
      this.pending.delete(peerId);
      rejectFn(err?.type === 'peer-unavailable' ? new Error('offline') : new Error('connect-failed'));
    });
    return promise;
  }

  async probe(friendName) {
    if (!this.peer || !this.peer.open) return false;
    const peerId = peerIdFor(friendName);
    if (peerId === this.id) return false;
    const existing = this.connections.get(peerId);
    if (existing && existing.open) return true;
    try {
      const conn = await this._openConnection(peerId, {
        role: 'probe', from: this.username, name: this.username,
      }, 4500);
      this._send(conn, { t: 'probe', name: this.username });
      const ok = await new Promise((resolve) => {
        const timer = setTimeout(() => resolve(false), 1800);
        const onData = (data) => {
          if (data && data.t === 'probe-ok') {
            clearTimeout(timer);
            conn.off('data', onData);
            resolve(true);
          }
        };
        conn.on('data', onData);
      });
      return ok;
    } catch {
      if (this.connections.get(peerId)?.open !== true) this.connections.delete(peerId);
      return false;
    }
  }

  async sendInvites(friendNames) {
    const party = [...new Set(friendNames.map(cleanUsername).filter(Boolean))];
    if (!this.peer || !this.peer.open || party.length === 0) {
      return { invited: [], failed: party };
    }
    const sessionId = `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    this.hostInvite = {
      sessionId,
      invited: new Map(),
      votes: { city: 0, race: 0 },
      hostChoice: null,
    };
    const invited = [];
    const failed = [];
    await Promise.all(party.map(async (name) => {
      try {
        const peerId = peerIdFor(name);
        const conn = await this._openConnection(peerId, {
          role: 'invite', from: this.username, sessionId,
        });
        this.connections.set(peerId, conn);
        this.hostInvite.invited.set(peerId, {
          name, conn, voted: false, choice: null,
        });
        invited.push(name);
        this._send(conn, {
          t: 'invite', from: this.username, sessionId,
          partySize: party.length + 1,
        });
      } catch {
        failed.push(name);
      }
    }));
    this._emitVotes();
    return { invited, failed, sessionId };
  }

  hostVote(choice) {
    if (!this.hostInvite) return;
    this.hostInvite.hostChoice = choice === 'race' ? 'race' : 'city';
    this.hostInvite.votes = { city: 0, race: 0 };
    this.hostInvite.votes[this.hostInvite.hostChoice]++;
    for (const entry of this.hostInvite.invited.values()) {
      if (entry.voted && entry.choice) this.hostInvite.votes[entry.choice]++;
    }
    this._emitVotes();
  }

  vote(choice) {
    // Before a session exists isHost is false, so the host is identified by
    // holding the pending invite instead.
    if (this.isHost || this.hostInvite) {
      this.hostVote(choice);
      return;
    }
    if (this.hostConn) this._send(this.hostConn, { t: 'vote', choice });
  }

  _voteSummary() {
    if (!this.hostInvite) return { city: 0, race: 0, voted: 0, total: 0 };
    const votes = this.hostInvite.votes;
    const invited = [...this.hostInvite.invited.values()];
    return {
      city: votes.city,
      race: votes.race,
      voted: (this.hostInvite.hostChoice ? 1 : 0) + invited.filter((v) => v.voted).length,
      total: 1 + invited.length,
    };
  }

  _emitVotes() {
    this.handlers.onVoteUpdate?.(this._voteSummary());
  }

  allVoted() {
    if (!this.hostInvite) return false;
    const invited = [...this.hostInvite.invited.values()];
    return this.hostInvite.hostChoice !== null && invited.every((v) => v.voted);
  }

  chooseVoteResult() {
    if (!this.hostInvite) return 'city';
    const votes = this.hostInvite.votes;
    if (votes.race > votes.city) return 'race';
    if (votes.city > votes.race) return 'city';
    return this.hostInvite.hostChoice || 'city';
  }

  startHostedSession(mode, spawn = null) {
    if (!this.hostInvite) return false;
    const host = {
      id: this.id, name: this.username, host: true, slot: 0,
    };
    const members = [host];
    let slot = 1;
    for (const [peerId, entry] of this.hostInvite.invited) {
      if (!entry.conn || !entry.conn.open) continue;
      members.push({ id: peerId, name: entry.name, host: false, slot });
      const member = { ...members[members.length - 1], conn: entry.conn };
      this.sessionMembers.set(peerId, member);
      slot++;
    }
    this.isHost = true;
    this.session = {
      sessionId: this.hostInvite.sessionId,
      mode: mode === 'race' ? 'race' : 'city',
      hostId: this.id,
      hostName: this.username,
      players: members,
      spawn: spawn || null,
      raceStartAt: Date.now() + 4200,
      startAt: Date.now() + 4200,
    };
    this.playerStates.clear();
    for (const member of members) {
      if (member.id === this.id) continue;
      const entry = this.hostInvite.invited.get(member.id);
      if (entry) this._send(entry.conn, { t: 'session-start', ...this.session });
    }
    this.hostInvite = null;
    return this.session;
  }

  joinReceivedSession(data) {
    this.isHost = false;
    this.session = data;
    this.sessionMembers.clear();
    for (const p of data.players || []) this.sessionMembers.set(p.id, p);
    return data;
  }

  sendState(state) {
    if (!this.session) return;
    if (this.isHost) {
      this.hostState = state;
      const now = performance.now();
      if (now - this.lastSnapshot > 90) this._broadcastSnapshot();
    } else if (this.hostConn) {
      this._send(this.hostConn, { t: 'state', state });
    }
  }

  _broadcastSnapshot(force = false) {
    if (!this.isHost || !this.session) return;
    const now = performance.now();
    if (!force && now - this.lastSnapshot < 90) return;
    this.lastSnapshot = now;
    const states = [];
    if (this.hostState) states.push(this.hostState);
    for (const state of this.playerStates.values()) states.push(state);
    for (const member of this.sessionMembers.values()) {
      if (member.id === this.id) continue;
      this._send(member.conn, { t: 'snapshot', states });
    }
  }

  declineInvite() {
    if (this.hostConn) {
      this._send(this.hostConn, { t: 'leave' });
      try { this.hostConn.close(); } catch { /* ignore */ }
    }
    this.hostConn = null;
    this.hostId = '';
  }

  cancelInvite(reason = 'The invite was cancelled.') {
    if (!this.hostInvite) return;
    for (const entry of this.hostInvite.invited.values()) {
      this._send(entry.conn, { t: 'session-end', reason });
      try { entry.conn.close(); } catch { /* ignore */ }
    }
    this.hostInvite = null;
    this.isHost = false;
    this.session = null;
    this.sessionMembers.clear();
    this.playerStates.clear();
    this.hostState = null;
  }

  leave() {
    if (this.isHost && this.session) {
      for (const member of this.sessionMembers.values()) {
        if (member.id === this.id) continue;
        this._send(member.conn, { t: 'session-end', reason: 'The host left the session.' });
      }
    } else if (this.hostConn) {
      this._send(this.hostConn, { t: 'leave' });
    }
    this.isHost = false;
    this.session = null;
    this.sessionMembers.clear();
    this.playerStates.clear();
    this.hostState = null;
    if (this.hostConn) {
      try { this.hostConn.close(); } catch { /* ignore */ }
    }
    this.hostConn = null;
  }
}
