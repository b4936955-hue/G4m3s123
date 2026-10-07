(function () {
  window.UZ_ACCOUNT_DEBUG = window.UZ_ACCOUNT_DEBUG || [];
  window.UZ_ACCOUNT_DEBUG.push('community-js-start');
  var cfg = window.UZ_COMMUNITY_CONFIG || {};
  var state = { client: null, user: null, profile: null, tab: 'chat', channelName: 'chat', realtime: null, profileRealtime: null, notificationUnsub: null, presenceChannel: null, onlineIds: {}, profileByUser: {}, memberRows: [], presenceReady: true, kickReady: true, heartbeatTimer: null, authUnsub: null, pendingChatAttachments: [], pendingPostAttachment: null, pendingAnnouncementAttachments: [], pendingAnnouncementEdits: {}, pendingPostEdits: {}, recentlyDeletedMessages: {}, jumpToLatest: true, firestoreCooldownUntil: 0 };
  var MAX_ATTACHMENTS = 20;
  var mongoApiUrl = String(cfg.mongoApiUrl || '').replace(/\/$/, '');
  var mongoMode = !!mongoApiUrl;
  var firebaseMode = !mongoMode && cfg.authProvider === 'firebase';
  var firebaseReady = firebaseMode && cfg.firebaseConfig && cfg.firebaseConfig.apiKey && cfg.firebaseConfig.projectId && window.firebase;
  var ready = mongoMode || firebaseReady || Boolean(cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase);
  var storageKey = 'uzCommunityProfileName';
  var channelInfo = {
    chat: { tab: 'chat', label: 'general-chat', title: 'General Chat', note: 'Live chat for everyone signed in.' },
    settings: { tab: 'posts', label: 'settings-share', title: 'Settings Share', note: 'Everyone can upload and copy settings presets.' },
    suggestions: { tab: 'posts', label: 'suggestions', title: 'Suggestions', note: 'Post ideas, bugs, and requests.' },
    'voice-lounge': { tab: 'voice', label: 'voice-lounge', title: 'Voice Lounge', note: 'Join the community voice room. Live mic audio needs WebRTC hosting.' },
    members: { tab: 'members', label: 'members', title: 'Members', note: 'Profiles and role hierarchy.' }
  };
  function $(id) { return document.getElementById(id); }
  function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function when(ts) { try { return new Date(ts).toLocaleString(); } catch (e) { return ''; } }
  function status(msg) { var el = $('community-status'); if (el) el.textContent = msg || ''; }
  function firebaseCooldown(error) {
    var message = String(error && (error.message || error.code) || error || '').toLowerCase();
    if (message.indexOf('resource-exhausted') === -1 && message.indexOf('quota') === -1 && message.indexOf('daily limit') === -1 && message.indexOf('rate') === -1) return false;
    var now = new Date(); var reset = new Date(now); reset.setHours(3, 0, 0, 0); if (reset <= now) reset.setDate(reset.getDate() + 1);
    state.firestoreCooldownUntil = reset.getTime();
    var banner = $('uz-firebase-cooldown');
    if (!banner) { banner = document.createElement('div'); banner.id = 'uz-firebase-cooldown'; banner.className = 'uz-firebase-cooldown'; document.body.appendChild(banner); }
    function tick() { var left = Math.max(0, state.firestoreCooldownUntil - Date.now()); var s = Math.ceil(left / 1000); var h = Math.floor(s / 3600); var m = Math.floor((s % 3600) / 60); var sec = s % 60; banner.textContent = 'Firebase is temporarily rate-limited. Data access resumes in ' + h + 'h ' + m + 'm ' + String(sec).padStart(2, '0') + 's. No account data was deleted.'; if (!left) { clearInterval(banner._timer); banner.remove(); state.firestoreCooldownUntil = 0; } }
    if (!banner._timer) banner._timer = setInterval(tick, 1000); tick();
    return true;
  }
  function firebaseAvailable() { return !state.firestoreCooldownUntil || state.firestoreCooldownUntil <= Date.now(); }
  function debugLog(label, detail) {
    try {
      window.UZ_ACCOUNT_DEBUG = window.UZ_ACCOUNT_DEBUG || [];
      window.UZ_ACCOUNT_DEBUG.push(new Date().toISOString() + ' community-' + label + (detail ? ': ' + detail : ''));
      if (window.UZ_ACCOUNT_DEBUG.length > 80) window.UZ_ACCOUNT_DEBUG.splice(0, window.UZ_ACCOUNT_DEBUG.length - 80);
    } catch(e) {}
  }
  function isTempOwner() { return window.UZTempOwnerActive === true; }
  function role() { if (isTempOwner()) return 'owner'; var a = state.profile || {}; var b = window.UZCurrentProfile || {}; var rank = { member: 0, mod: 1, admin: 2, co_owner: 3, owner: 4 }; return (rank[b.role] || 0) > (rank[a.role] || 0) ? b.role : (a.role || b.role || 'member'); }
  function isDeleted(profile) { return profile && profile.role === 'deleted'; }
  function isBanned(profile) { return profile && (profile.role === 'banned' || (profile.banned_until && new Date(profile.banned_until) > new Date())); }
  function isKicked(profile) { return profile && state.kickReady && profile.kicked_until && new Date(profile.kicked_until) > new Date(); }
  function isMuted(profile) { return profile && profile.muted_until && new Date(profile.muted_until) > new Date(); }
  function isOwner() { return role() === 'owner'; }
  function isCoOwner() { return role() === 'co_owner'; }
  function isRealOwner() { return role() === 'owner' && !isTempOwner() && !!state.user; }
  function isRealSeniorStaff() { return !isTempOwner() && !!state.user && (isOwner() || isCoOwner()); }
  function isStaff() { return ['owner','co_owner','admin','mod'].indexOf(role()) !== -1 || isTempOwner(); }
  function canPost() { return state.channelName === 'settings' || state.channelName === 'suggestions' || (state.channelName === 'announcements' && isStaff()) || (state.tab === 'posts' && isStaff()); }
  function canEditPost(row) { return isOwner() || isCoOwner() || role() === 'admin' || (role() === 'mod' && state.user && row.user_id === state.user.id); }
  function canDeletePost(row) { return isOwner() || isCoOwner() || role() === 'admin' || (role() === 'mod' && state.user && row.user_id === state.user.id); }
  function canEditMessage(row) { return !!(state.user && row && String(row.user_id) === String(state.user.id) && !row.deleted_at); }
  function canDeleteMessage(row) { return !!(row && !row.deleted_at && (isOwner() || isCoOwner() || role() === 'admin' || (state.user && String(row.user_id) === String(state.user.id)))); }
  function canBroadcastMention() { return ['owner', 'co_owner', 'admin'].indexOf(role()) !== -1; }
  function rejectRestrictedMention(text, input) { if (/(^|\s)@(everyone|here)\b/i.test(String(text || '')) && !canBroadcastMention()) { warnBlockedInput(input, '@everyone and @here are restricted to admins and above.'); return true; } return false; }
  function notifySaved(msg) { var n = $('community-save-note') || $('uz-autosave-note'); if (!n) { n = document.createElement('div'); n.id = 'community-save-note'; n.className = 'community-save-note'; document.body.appendChild(n); } n.textContent = msg || 'Saved'; n.classList.add('show'); clearTimeout(notifySaved.t); notifySaved.t = setTimeout(function(){ n.classList.remove('show'); }, 1500); }
  function normalizeName(v) { return String(v || '').replace(/\s+/g, ' ').trim().slice(0, cfg.maxNameLength || 24); }
  function hasBadWord(v) { var s = String(v || '').toLowerCase().replace(/[^a-z0-9]/g, ''); return (cfg.blockedWords || []).some(function (w) { return s.indexOf(String(w).toLowerCase().replace(/[^a-z0-9]/g, '')) !== -1; }); }
  function validName(v) { v = normalizeName(v); return v.length >= (cfg.minNameLength || 2) && !hasBadWord(v); }
  function profileUsername() { return state.profile && state.profile.username ? state.profile.username : (state.user && state.user.email ? state.user.email.split('@')[0] : 'guest'); }
  function getName() { if (isTempOwner() && !state.user) return 'Temporary Owner'; return normalizeName(localStorage.getItem(storageKey + ':' + profileUsername()) || ''); }
  function normalizeAvatar(value) { value = String(value || '').trim(); if (!value) return ''; try { var url = new URL(value, window.location.href); if (['http:', 'https:', 'data:'].indexOf(url.protocol) === -1) return ''; return url.href.slice(0, 320000); } catch (e) { return ''; } }
  function getAvatar() { return normalizeAvatar((state.profile && state.profile.avatar_url) || localStorage.getItem('uzCommunityAvatar:' + profileUsername()) || ''); }
  function initClient() { if (firebaseMode && firebaseReady && !state.client) { if (!window.firebase.apps.length) window.firebase.initializeApp(cfg.firebaseConfig); state.client = { auth: window.firebase.auth(), db: window.firebase.firestore() }; return; } if (!mongoMode && ready && !state.client) state.client = window.supabase.createClient(String(cfg.supabaseUrl || '').replace(/\/rest\/v1\/?$/, '').replace(/\/$/, ''), cfg.supabaseAnonKey); }
  function mongoToken() { return localStorage.getItem('uzMongoToken') || sessionStorage.getItem('uzMongoToken') || ''; }
  async function mongoFetch(path, options) {
    options = options || {};
    options.headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
    var token = mongoToken();
    if (token) options.headers.Authorization = 'Bearer ' + token;
    var controller = window.AbortController ? new AbortController() : null;
    var timeout = setTimeout(function(){ if (controller) controller.abort(); }, Number(options.timeout || 16000));
    if (controller) options.signal = controller.signal;
    delete options.timeout;
    var res;
    try {
      res = await fetch(mongoApiUrl + path, options);
    } catch (e) {
      debugLog('api-failed', path + ' ' + (e && e.name ? e.name : 'fetch'));
      var offline = new Error('Mongo account API is not reachable at ' + mongoApiUrl + '. If this host is blocked, switch the API URL to a different deployed host.');
      offline.cause = e;
      offline.offline = true;
      throw offline;
    } finally {
      clearTimeout(timeout);
    }
    var data = await res.json().catch(function(){ return {}; });
    if (!res.ok) { var err = new Error(data.error || 'Mongo API request failed.'); err.status = res.status; err.data = data; throw err; }
    return data;
  }
  function fromMongoUser(u) { return u ? { id: u.id, username: u.username, display_name: u.displayName || u.username, role: u.role || 'member', warnings: u.warnings || 0, banned_until: u.bannedUntil, kicked_until: u.kickedUntil, muted_until: u.mutedUntil, last_seen: u.lastSeen } : null; }
  function mongoMessage(row) { var id = row._id && (row._id.$oid || row._id); return { id: id, user_id: row.userId && (row.userId.$oid || row.userId), body: row.body, deleted_body: row.deletedBody, deleted_at: row.deletedAt, updated_at: row.editedAt, created_at: row.createdAt, profiles: { username: row.username, display_name: row.username, role: 'member' } }; }
  function mongoPost(row) { var id = row._id && (row._id.$oid || row._id); return { id: id, user_id: row.userId && (row.userId.$oid || row.userId), title: row.title, body: row.body, attachment: row.attachment || null, deleted_at: row.deletedAt, created_at: row.createdAt, profiles: { username: row.username, display_name: row.username, role: 'staff' } }; }
  function fromFirebaseProfile(id, data) { data = data || {}; return { id: id || data.id, username: data.username, display_name: data.display_name || data.displayName || data.username, avatar_url: data.avatar_url || data.avatarUrl || '', role: data.role || 'member', warnings: data.warnings || 0, banned_until: data.banned_until || data.bannedUntil || null, banned_at: data.banned_at || data.bannedAt || null, ban_id: data.ban_id || data.banId || null, kicked_until: data.kicked_until || data.kickedUntil || null, muted_until: data.muted_until || data.mutedUntil || null, last_seen: data.last_seen || data.lastSeen || null, email: data.email || '' }; }
  function firebaseRow(doc) { var d = doc.data() || {}; d.id = doc.id; d.user_id = d.user_id || d.userId; d.created_at = d.created_at || d.createdAt; d.updated_at = d.updated_at || d.updatedAt; d.deleted_at = d.deleted_at || d.deletedAt; d.deleted_body = d.deleted_body || d.deletedBody; return d; }
  function displayName() { return getName() || (state.profile && (state.profile.display_name || state.profile.username)) || (state.user && state.user.email ? state.user.email.split('@')[0] : 'Member'); }
  function authorLabel(p, row) { p = p || {}; row = row || {}; var display = p.display_name || p.username || row.username || 'Member'; var username = p.username || row.username || ''; return esc(display) + (username ? ' <small>@' + esc(username) + '</small>' : ''); }
  function profileAvatarHtml(profile, sizeClass) { var name = (profile && (profile.display_name || profile.username)) || 'M'; var avatar = String((profile && profile.avatar_url) || '').trim(); return avatar ? '<button type="button" class="community-profile-avatar ' + (sizeClass || '') + '" data-avatar-preview="' + esc(avatar) + '" aria-label="View ' + esc(name) + ' profile image"><img src="' + esc(avatar) + '" alt="' + esc(name) + '"></button>' : '<span class="community-profile-avatar ' + (sizeClass || '') + '">' + esc(name.charAt(0).toUpperCase()) + '</span>'; }
  function mergeProfile(profile) { if (!profile) return; var rank = { member: 0, mod: 1, admin: 2, co_owner: 3, owner: 4 }; var cur = state.profile || {}; state.profile = Object.assign({}, cur, profile); if ((rank[(window.UZCurrentProfile || {}).role] || 0) > (rank[state.profile.role] || 0)) state.profile.role = window.UZCurrentProfile.role; window.UZCurrentProfile = state.profile; }
  function profileFields() { return 'id, username, display_name, role, warnings, banned_until, muted_until' + (state.kickReady ? ', kicked_until' : '') + ', staff_note' + (state.presenceReady ? ', last_seen' : ''); }
  function isOnline(profile) { if (!profile) return false; if (state.user && String(profile.id) === String(state.user.id)) return true; if (state.onlineIds && state.onlineIds[String(profile.id)]) return true; if (!profile.last_seen) return false; var t = new Date(profile.last_seen).getTime(); return Number.isFinite(t) && Date.now() - t < 90000; }
  async function touchPresence() { if (firebaseMode) { if (!state.user || !state.client) return; try { await state.client.db.collection('profiles').doc(state.user.id).set({ last_seen: new Date().toISOString(), email: state.user.email || '' }, { merge: true }); } catch(e) {} return; } if (mongoMode) { try { var mine = await mongoFetch('/me'); mergeProfile(fromMongoUser(mine.user)); } catch(e) { if (e.status === 401 || e.status === 403) await forceSignedOut(e.message || 'Your account session ended.', e.data && e.data.banned ? profileUsername() : null); } return; } if (!ready || !state.client || !state.user || !state.presenceReady) return; var res = await state.client.from('profiles').update({ last_seen: new Date().toISOString() }).eq('id', state.user.id).select(profileFields()).single(); if (res.error) { if (/last_seen/i.test(res.error.message || '')) state.presenceReady = false; return; } if (res.data) mergeProfile(res.data); }
  function startHeartbeat() { clearInterval(state.heartbeatTimer); if (!state.user) return; touchPresence(); state.heartbeatTimer = setInterval(function(){ touchPresence(); }, (mongoMode || firebaseMode) ? 60000 : 25000); }
  function subscribePresence() {
    if (!ready || !state.client || !state.user) return;
    if (state.presenceChannel) state.client.removeChannel(state.presenceChannel);
    state.onlineIds = {};
    var username = (state.profile && state.profile.username) || (state.user.email || '').split('@')[0] || state.user.id;
    state.presenceChannel = state.client.channel('uz-community-presence', { config: { presence: { key: state.user.id } } });
    state.presenceChannel.on('presence', { event: 'sync' }, function(){
      var seen = {};
      var all = state.presenceChannel.presenceState();
      Object.keys(all || {}).forEach(function(key){
        (all[key] || []).forEach(function(p){ if (p && p.user_id) seen[String(p.user_id)] = true; });
      });
      state.onlineIds = seen;
      loadMembers(state.tab === 'members');
    });
    state.presenceChannel.subscribe(function(status){
      if (status === 'SUBSCRIBED') state.presenceChannel.track({ user_id: state.user.id, username: username, online_at: new Date().toISOString() });
    });
  }
  function handleProfileError(error) {
    var msg = error && error.message ? error.message : '';
    var changed = false;
    if (/last_seen/i.test(msg)) { state.presenceReady = false; changed = true; }
    if (/kicked_until/i.test(msg)) { state.kickReady = false; changed = true; }
    return changed;
  }
  function subscribeOwnProfile() {
    if (firebaseMode) {
      if (!ready || !state.client || !state.user) return;
      subscribeCloudNotifications();
      if (typeof state.profileRealtime === 'function') state.profileRealtime();
      state.profileRealtime = state.client.db.collection('profiles').doc(state.user.id).onSnapshot(async function(doc){
        if (!doc.exists) { await forceSignedOut('This account was deleted.', null, profileUsername()); return; }
        mergeProfile(fromFirebaseProfile(doc.id, doc.data()));
        if (isDeleted(state.profile)) await forceSignedOut('This account was deleted.', null, (state.profile && state.profile.username) || profileUsername());
        else if (isBanned(state.profile)) await forceSignedOut('This account is banned.', (state.profile && state.profile.username) || 'this account');
        else if (isKicked(state.profile)) await forceSignedOut('You were kicked from this account until ' + when(state.profile.kicked_until) + '.');
        else clearDeviceBan((state.profile && state.profile.username) || profileUsername());
        loadMembers(state.tab === 'members');
      });
      return;
    }
    if (!ready || !state.client || !state.user) return;
    if (state.profileRealtime) state.client.removeChannel(state.profileRealtime);
    state.profileRealtime = state.client.channel('uz-profile-' + state.user.id).on('postgres_changes', { event: '*', schema: 'public', table: 'profiles', filter: 'id=eq.' + state.user.id }, async function(payload){
      if (payload && payload.eventType === 'DELETE') {
        var deletedName = (state.profile && state.profile.username) || 'this account';
        await forceSignedOut(deletedName + ' was deleted by an owner.');
        loadItems();
        return;
      }
      if (payload && payload.new) mergeProfile(payload.new);
      if (isBanned(state.profile)) {
        await forceSignedOut('This account is banned.', (state.profile && state.profile.username) || 'this account');
      } else if (isKicked(state.profile)) {
        await forceSignedOut('You were kicked from this account until ' + when(state.profile.kicked_until) + '.');
      }
      loadMembers(state.tab === 'members');
    }).subscribe();
  }
  function audit(action, detail) {
    var entry = { action: action, detail: detail || '', by: profileUsername(), at: new Date().toISOString() };
    try { var logs = JSON.parse(localStorage.getItem('uzAuditLog') || '[]'); logs.unshift(entry); localStorage.setItem('uzAuditLog', JSON.stringify(logs.slice(0, 300))); } catch(e) {}
    if (firebaseMode && state.client && state.user && isStaff()) {
      state.client.db.collection('staffLogs').add({ action: entry.action, detail: entry.detail, actor_id: state.user.id, actor_username: entry.by, created_at: entry.at }).catch(function(error){ debugLog('staff-log-failed', error && error.message); });
    }
  }
  async function loadStaffLogs() {
    var local = [];
    try { local = JSON.parse(localStorage.getItem('uzAuditLog') || '[]'); } catch(e) {}
    if (!firebaseMode || !state.client || !state.user || !isStaff()) return local;
    try {
      var snap = await state.client.db.collection('staffLogs').limit(300).get();
      return snap.docs.map(function(doc){ var row = doc.data() || {}; return { action: row.action, detail: row.detail, by: row.actor_username || row.actor_id || 'staff', at: row.created_at || Date.now() }; }).sort(function(a,b){ return new Date(b.at).getTime() - new Date(a.at).getTime(); });
    } catch(e) { debugLog('staff-log-read-failed', e && e.message); return local; }
  }
  function subscribeCloudNotifications() {
    if (!firebaseMode || !state.client || !state.user) return;
    if (typeof state.notificationUnsub === 'function') state.notificationUnsub();
    state.notificationUnsub = state.client.db.collection('notifications').where('recipient_id', '==', state.user.id).limit(100).onSnapshot(function(snapshot){
      snapshot.docChanges().forEach(function(change){
        if (change.type !== 'added') return;
        var data = change.doc.data() || {};
        if (window.UZNotify && window.UZNotify.add) window.UZNotify.add(data.text || 'New notification', 'remote:' + change.doc.id, data);
      });
    }, function(error){ debugLog('notifications-failed', error && error.message); });
  }
  async function notifyUsers(userIds, text, target) {
    if (!firebaseMode || !state.client || !state.user) return;
    var ids = (userIds || []).map(String).filter(function(id, index, all){ return id && id !== String(state.user.id) && all.indexOf(id) === index; }).slice(0, 450);
    if (!ids.length) return;
    var batch = state.client.db.batch();
    ids.forEach(function(id){ var ref = state.client.db.collection('notifications').doc(); batch.set(ref, { recipient_id: id, sender_id: state.user.id, sender_username: profileUsername(), text: String(text || 'Notification').slice(0, 500), target: target || null, read: false, created_at: new Date().toISOString() }); });
    try { await batch.commit(); } catch(e) { debugLog('notification-write-failed', e && e.message); }
  }
  function notifyMentionedUsers(text, target) {
    var names = String(text || '').match(/@([a-z0-9_.-]+)/ig) || [];
    var wanted = names.map(function(value){ return value.slice(1).toLowerCase(); }).filter(function(name){ return name !== 'everyone'; });
    var ids = (state.memberRows || []).filter(function(profile){ return wanted.indexOf(String(profile.username || '').toLowerCase()) !== -1; }).map(function(profile){ return profile.id; });
    if (names.some(function(value){ return value.toLowerCase() === '@everyone'; })) ids = ids.concat((state.memberRows || []).map(function(profile){ return profile.id; }));
    return notifyUsers(ids, profileUsername() + ' mentioned you: ' + String(text || '').slice(0, 420), target);
  }
  function pingEveryone(title) { var text = '@everyone: ' + (title || 'New announcement'); if (window.UZNotify && window.UZNotify.add) window.UZNotify.add(text); notifyUsers((state.memberRows || []).map(function(profile){ return profile.id; }), text, { tab: 'posts' }); }
  function clearDeviceBan(username) { try { var u = String(username || '').toLowerCase(); if (!u || localStorage.getItem('uzSiteBanned') === u) localStorage.removeItem('uzSiteBanned'); if (u) localStorage.removeItem('uzBannedAccount:' + u); localStorage.removeItem('uzSiteBannedUid'); } catch(e) {} }
  async function forceSignedOut(message, bannedName, deletedName) { try { if (state.client && !mongoMode && !bannedName) await state.client.auth.signOut(); } catch(e) {} try { sessionStorage.removeItem('uzSessionOk'); if (!bannedName) localStorage.removeItem('uzLoginEmail'); localStorage.removeItem('uzMongoToken'); sessionStorage.removeItem('uzMongoToken'); if (deletedName) { var u = String(deletedName).toLowerCase(); localStorage.setItem('uzRecentAccounts', JSON.stringify((JSON.parse(localStorage.getItem('uzRecentAccounts') || '[]') || []).filter(function(a){ return String(a.username || '').toLowerCase() !== u; }))); } if (bannedName) { localStorage.setItem('uzBannedAccount:' + String(bannedName).toLowerCase(), '1'); localStorage.setItem('uzSiteBanned', String(bannedName).toLowerCase()); if (state.user && state.user.id) localStorage.setItem('uzSiteBannedUid', state.user.id); } } catch(e) {} if (!bannedName) { state.user = null; state.profile = null; } renderUser(); renderComposer(); if (bannedName && window.UZAuthGate && window.UZAuthGate.showBanned) window.UZAuthGate.showBanned(bannedName); else if (window.UZAuthGate) window.UZAuthGate.showLogin(message || 'Your account session ended.'); }
  function renderSetup() { var setup = $('community-setup'); if (setup) setup.classList.toggle('community-hidden', ready); }
  function renderUser() {
    var box = $('community-user'); if (!box) return;
    var signed = state.user ? 'Signed in as <b>' + esc((state.profile && state.profile.username) || (state.user.email || 'user').split('@')[0]) + '</b>.' : (isTempOwner() ? 'Using temporary owner mode.' : 'Sign in from the account gate first.');
    var review = state.user && ['owner','co_owner','admin'].indexOf(role()) !== -1 ? '<button class="community-btn secondary" id="community-review-appeals" type="button">Review appeals</button>' : '';
    box.innerHTML = '<div class="community-auth"><p>' + signed + '</p><p>Role: <b>' + esc(role()) + '</b></p><p>Pick a channel on the left. Open member cards to view profiles. Owners can adjust roles in Members.</p>' + review + '</div>';
    var reviewButton = $('community-review-appeals'); if (reviewButton) reviewButton.onclick = openAppealReview;
    Array.prototype.forEach.call(document.querySelectorAll('.community-staff-tab,.community-staff-only'), function(btn){ btn.classList.toggle('community-hidden', !isStaff()); });
  }
  function proofMarkup(appeal) {
    var image = String(appeal.proof_image || '').trim();
    var url = String(appeal.proof_url || '').trim();
    var html = '';
    if (/^data:image\//i.test(image)) html += '<img class="community-appeal-proof" src="' + esc(image) + '" alt="Appeal proof">';
    if (/^https?:\/\//i.test(url)) html += '<a class="community-appeal-link" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">Open proof link</a>';
    return html;
  }
  async function reviewAppeal(id, decision) {
    if (!firebaseMode || !state.user || ['owner','admin'].indexOf(role()) === -1) { status('Admin or owner required.'); return; }
    try {
      initClient();
      var ref = state.client.db.collection('appeals').doc(String(id));
      var snap = await ref.get();
      if (!snap.exists) throw new Error('That appeal no longer exists.');
      var appeal = snap.data() || {};
      var changes = { status: decision, reviewed_by: profileUsername(), reviewed_at: new Date().toISOString() };
      await ref.set(changes, { merge: true });
      if (decision === 'accepted' && appeal.user_id) {
        await state.client.db.collection('profiles').doc(String(appeal.user_id)).set({ role: 'member', warnings: 0, banned_until: null, banned_at: null, ban_id: null }, { merge: true });
      }
      notifySaved(decision === 'accepted' ? 'Appeal accepted and account unbanned.' : 'Appeal denied.');
      openAppealReview();
    } catch (error) { status(error.message || 'Appeal review failed.'); }
  }
  async function openAppealReview() {
    if (!firebaseMode || !state.user || ['owner','admin'].indexOf(role()) === -1) { status('Admin or owner required to review appeals.'); return; }
    var old = document.getElementById('community-appeal-pop'); if (old) old.remove();
    var modal = document.createElement('div'); modal.id = 'community-appeal-pop'; modal.className = 'community-profile-pop';
    modal.innerHTML = '<div class="community-profile-card community-appeal-card"><button class="uz-profile-modal-close" id="community-appeal-close">Close</button><h2>Ban appeals</h2><div id="community-appeal-list">Loading appeals...</div></div>';
    document.body.appendChild(modal);
    document.getElementById('community-appeal-close').onclick = function(){ modal.remove(); };
    modal.addEventListener('click', function(e){ if (e.target === modal) modal.remove(); });
    try {
      initClient();
      var snap = await state.client.db.collection('appeals').limit(100).get();
      var rows = snap.docs.map(function(doc){ var data = doc.data() || {}; data.id = doc.id; return data; }).filter(function(row){ return row.status === 'pending'; }).sort(function(a,b){ return String(b.created_at || '').localeCompare(String(a.created_at || '')); });
      var list = document.getElementById('community-appeal-list');
      list.innerHTML = rows.map(function(row){ return '<article class="community-appeal"><h3>@' + esc(row.username || 'member') + '</h3><p><b>What happened:</b> ' + esc(row.reason || '') + '</p><p><b>Why lift it:</b> ' + esc(row.details || '') + '</p>' + proofMarkup(row) + '<small>' + esc(when(row.created_at)) + '</small><div class="community-actions"><button class="community-btn community-appeal-accept" data-appeal-id="' + esc(row.id) + '">Accept</button><button class="community-btn danger community-appeal-deny" data-appeal-id="' + esc(row.id) + '">Deny</button></div></article>'; }).join('') || '<p>No pending appeals.</p>';
      Array.prototype.forEach.call(list.querySelectorAll('.community-appeal-accept'), function(btn){ btn.onclick = function(){ reviewAppeal(btn.dataset.appealId, 'accepted'); }; });
      Array.prototype.forEach.call(list.querySelectorAll('.community-appeal-deny'), function(btn){ btn.onclick = function(){ reviewAppeal(btn.dataset.appealId, 'denied'); }; });
    } catch (error) { var list = document.getElementById('community-appeal-list'); if (list) list.textContent = error.message || 'Could not load appeals.'; }
  }
  async function updateProfileDetails(name, avatar) {
    name = normalizeName(name || profileUsername());
    if (!validName(name)) throw new Error('Pick a clean profile name, 2-' + (cfg.maxNameLength || 24) + ' characters.');
    avatar = normalizeAvatar(avatar);
    if (avatar && avatar.length > 320000) throw new Error('That profile image is too large after compression.');
    if (state.user && firebaseMode) {
      initClient();
      await state.client.db.collection('profiles').doc(state.user.id).set({ display_name: name, avatar_url: avatar, profile_updated_at: new Date().toISOString() }, { merge: true });
      mergeProfile(Object.assign({}, state.profile || {}, { display_name: name, avatar_url: avatar }));
    }
    try { localStorage.setItem(storageKey + ':' + profileUsername(), name); localStorage.setItem('uzCommunityAvatar:' + profileUsername(), avatar); } catch(e) {}
    renderUser(); renderComposer();
    return true;
  }
  async function saveProfile() { try { return await updateProfileDetails(displayName(), getAvatar()); } catch (error) { status(error.message || 'Profile could not be saved.'); return false; } }
  async function logout() { if (mongoMode) { localStorage.removeItem('uzMongoToken'); sessionStorage.removeItem('uzMongoToken'); } else if (state.client) await state.client.auth.signOut(); state.user = null; state.profile = null; status('Signed out.'); renderUser(); renderComposer(); loadItems(); if (window.UZAuthGate) window.UZAuthGate.refresh(); }
  async function upsertProfile() {
    if (!ready || !state.user) return;
    initClient();
    if (firebaseMode) {
      var username = (state.user.email || '').split('@')[0] || state.user.id;
      var ref = state.client.db.collection('profiles').doc(state.user.id);
       var deletedMarker = await state.client.db.collection('deletedAccounts').doc(state.user.id).get();
       if (deletedMarker.exists) { await forceSignedOut('This account was deleted.', null, username); return; }
      var doc = await ref.get();
      var avatar = normalizeAvatar(localStorage.getItem('uzCommunityAvatar:' + username) || '');
      if (!doc.exists) {
        await ref.set({ id: state.user.id, username: username, display_name: displayName() || username, avatar_url: avatar, role: 'member', warnings: 0, email: state.user.email || '', created_at: new Date().toISOString(), last_seen: new Date().toISOString() });
      } else {
        await ref.set({ last_seen: new Date().toISOString(), email: state.user.email || '' }, { merge: true });
      }
      doc = await ref.get();
      mergeProfile(fromFirebaseProfile(doc.id, doc.data()));
      if (isDeleted(state.profile)) await forceSignedOut('This account was deleted.', null, (state.profile && state.profile.username) || username);
      else if (isBanned(state.profile)) await forceSignedOut('This account is banned.', (state.profile && state.profile.username) || username);
      return;
    }
    if (mongoMode) { try { var mine = await mongoFetch('/me'); mergeProfile(fromMongoUser(mine.user)); } catch (e) {} return; }
    var payload = { id: state.user.id, display_name: displayName() };
    if (state.presenceReady) payload.last_seen = new Date().toISOString();
    var res = await state.client.from('profiles').upsert(payload, { onConflict: 'id' }).select(profileFields()).single();
    if (!res.error && res.data) mergeProfile(res.data);
  }
  async function refreshSession() { if (!ready) { renderSetup(); renderUser(); renderComposer(); loadItems(); return; } if (firebaseMode) { initClient(); var fb = state.client.auth.currentUser; state.user = fb ? { id: fb.uid, email: fb.email || '' } : null; if (state.user) { await upsertProfile(); startHeartbeat(); subscribeOwnProfile(); } if (!state.authUnsub) state.authUnsub = state.client.auth.onAuthStateChanged(async function(user){ state.user = user ? { id: user.uid, email: user.email || '' } : null; if (state.user) { await upsertProfile(); startHeartbeat(); subscribeOwnProfile(); } else { clearInterval(state.heartbeatTimer); if (typeof state.profileRealtime === 'function') { state.profileRealtime(); state.profileRealtime = null; } if (typeof state.realtime === 'function') { state.realtime(); state.realtime = null; } state.profile = null; } renderUser(); renderComposer(); loadItems(); subscribe(); }); renderSetup(); renderUser(); renderComposer(); loadItems(); subscribe(); return; } if (mongoMode) { try { var mine = await mongoFetch('/me'); var p = fromMongoUser(mine.user); state.user = { id: p.id, email: p.username + '@' + (cfg.internalAuthDomain || 'uzlogin.net') }; mergeProfile(p); startHeartbeat(); } catch(e) { state.user = null; state.profile = null; } renderSetup(); renderUser(); renderComposer(); loadMembers(state.tab === 'members'); loadItems(); return; } initClient(); var session = await state.client.auth.getSession(); state.user = session.data && session.data.session ? session.data.session.user : null; if (state.user) { await upsertProfile(); startHeartbeat(); subscribePresence(); subscribeOwnProfile(); } state.client.auth.onAuthStateChange(async function (_event, sessionData) { state.user = sessionData && sessionData.user ? sessionData.user : null; if (state.user) { await upsertProfile(); startHeartbeat(); subscribePresence(); subscribeOwnProfile(); } else { clearInterval(state.heartbeatTimer); if (state.presenceChannel) state.client.removeChannel(state.presenceChannel); if (state.profileRealtime) state.client.removeChannel(state.profileRealtime); state.onlineIds = {}; state.profile = null; } renderUser(); renderComposer(); loadItems(); subscribe(); }); renderSetup(); renderUser(); renderComposer(); loadItems(); subscribe(); }
  function postAllowedMessage() { if (state.channelName === 'announcements') return 'Announcements are staff-only. Members can read and copy.'; return 'Sign in to post here.'; }
  function renderComposer() {
    var chat = $('community-chat-form'); var post = $('community-post-form'); var staff = $('community-staff-form'); if (!chat || !post || !staff) return;
    chat.classList.toggle('community-hidden', state.tab !== 'chat'); post.classList.toggle('community-hidden', state.tab !== 'posts'); staff.classList.toggle('community-hidden', true);
    var ok = state.user && !isBanned(state.profile) && !isMuted(state.profile);
    chat.innerHTML = ok ? '<textarea id="community-chat-input" maxlength="1000" placeholder="Message #' + esc(channelInfo[state.channelName].label) + '"></textarea><div class="community-composer-actions"><label class="community-file-label">Upload files<input id="community-chat-file-input" type="file" multiple></label><span class="community-attachment-choice" id="community-chat-file-choice">No files selected</span><button class="community-btn" id="community-send-chat">Send</button></div>' : '<div class="community-message community-locked">Sign in with a real account to chat.</div>';
    if (ok) showAttachmentQueue('community-chat-file-choice', state.pendingChatAttachments);
    var postOk = ok && canPost();
    var titlePh = state.channelName === 'settings' ? 'Preset name' : (state.channelName === 'suggestions' ? 'Suggestion title' : 'Thread title');
    var bodyPh = state.channelName === 'settings' ? 'Describe this settings preset, or press Attach settings.' : 'Post text, links, updates, settings, images, or files.';
    post.innerHTML = postOk ? '<div class="community-post-composer"><input id="community-post-title" maxlength="120" placeholder="' + titlePh + '"><textarea id="community-post-body" maxlength="7000" placeholder="' + bodyPh + '"></textarea><div class="community-composer-actions"><button class="community-btn secondary" id="community-attach-settings" type="button">Attach settings</button><label class="community-file-label">Upload file<input id="community-file-input" type="file"></label><span class="community-attachment-choice" id="community-file-choice">No file selected</span><button class="community-btn" id="community-send-post">Publish</button></div></div>' : '<div class="community-message community-locked">' + postAllowedMessage() + '</div>';
    var sendChat = $('community-send-chat'); if (sendChat) sendChat.onclick = sendMessageV2;
    var chatFile = $('community-chat-file-input'); if (chatFile) chatFile.onchange = attachFileToChat;
    var sendPost = $('community-send-post'); if (sendPost) sendPost.onclick = sendPostMessage;
    var attachSettings = $('community-attach-settings'); if (attachSettings) attachSettings.onclick = attachSettingsPreset;
    var attachFile = $('community-file-input'); if (attachFile) attachFile.onchange = attachFileToPost;
    var chatInput = $('community-chat-input');
    if (chatInput) chatInput.addEventListener('input', function(){ chatInput.classList.toggle('has-mention-preview', /(^|\s)@(everyone|here|[a-z0-9_.-]+)$/i.test(chatInput.value.slice(0, chatInput.selectionStart || chatInput.value.length))); });
    if (chatInput) chatInput.addEventListener('keydown', function(e){
      if (e.key === 'Enter' && !e.shiftKey && !e.defaultPrevented) { e.preventDefault(); sendMessageV2(); }
    });
    wireMentionComplete(chatInput);
    wireMentionComplete($('community-post-body'));
  }
  function decorateMentions(text) {
    var output = esc(text);
    output = output.replace(/(https?:\/\/[^\s<]+)/gi, function(url){ return '<a class="community-external-link" href="' + url + '" target="_blank" rel="noopener noreferrer">' + url + '</a>'; });
    output = output.replace(/@([a-z0-9_.-]+)/gi, function(_all, name){ return '<span class="community-mention' + (String(name).toLowerCase() === 'everyone' ? ' is-everyone' : '') + '">@' + name + '</span>'; });
    return output.replace(/\n/g, '<br>');
  }
  function attachmentData(attachment) { return attachment && String(attachment.data_url || attachment.dataUrl || attachment.url || '').trim(); }
  function attachmentName(attachment) { return attachment && String(attachment.name || 'File').trim().slice(0, 120); }
  function attachmentHtml(attachment, legacy) {
    var data = attachmentData(attachment), name = attachmentName(attachment), type = String((attachment && attachment.type) || '').toLowerCase();
    if (!data) return '';
    if (legacy) return '<div class="community-attachment-embed is-legacy"><b>' + esc(name) + '</b><small>An older attachment cannot be previewed. Upload it again to restore the image.</small></div>';
    if (/^data:image\//i.test(data) || /^image\//i.test(type)) return '<figure class="community-attachment-embed"><img src="' + esc(data) + '" alt="' + esc(name) + '"></figure>';
    if (/^data:video\//i.test(data) || /^video\//i.test(type)) return '<figure class="community-attachment-embed"><video controls preload="metadata" src="' + esc(data) + '"></video></figure>';
    if (!/^data:|^https?:\/\//i.test(data)) return '';
    return '<a class="community-file-attachment" href="' + esc(data) + '" download="' + esc(name) + '"><span class="community-file-icon">FILE</span><span><b>' + esc(name) + '</b><small>' + esc(type || 'File attachment') + '</small></span><strong>Download</strong></a>';
  }
  function renderRichBody(text, attachment) {
    var raw = String(text || '');
    var match = raw.match(/(?:^|\n)Attached file:\s*([^\n]+)\n(data:[^\s]+)/);
    var legacy = null;
    if (match) {
      legacy = { name: match[1].trim(), data_url: match[2].trim() };
      raw = raw.slice(0, match.index).trim();
    }
    var body = raw ? '<div class="community-rich-text">' + decorateMentions(raw) + '</div>' : '';
    var attachments = Array.isArray(attachment) ? attachment : (attachment ? [attachment] : []);
    if (legacy && !attachments.length) attachments = [legacy];
    var embeds = (raw.match(/https?:\/\/[^\s<]+/gi) || []).filter(function(url){ return /\.(?:png|jpe?g|gif|webp|avif)(?:[?#].*)?$/i.test(url) || /\.(?:mp4|webm|ogg)(?:[?#].*)?$/i.test(url); }).slice(0, 4).map(function(url){
      return /\.(?:mp4|webm|ogg)(?:[?#].*)?$/i.test(url) ? '<figure class="community-attachment-embed"><video controls preload="metadata" src="' + esc(url) + '"></video></figure>' : '<figure class="community-attachment-embed"><img src="' + esc(url) + '" alt="Embedded image"></figure>';
    }).join('');
    return body + embeds + attachments.map(function(item){ return attachmentHtml(item, !!legacy && item === legacy); }).join('');
  }
  function wireMentionComplete(el) {
    if (!el || el.dataset.mentionReady === '1') return;
    el.dataset.mentionReady = '1';
    function menu() { return $('community-mention-menu'); }
    function close() { var old = menu(); if (old) old.remove(); }
    function selection() {
      var start = el.selectionStart || 0, before = el.value.slice(0, start), match = before.match(/(^|\s)@([a-z0-9_.-]*)$/i);
      return match ? { start: start, at: before.lastIndexOf('@'), query: String(match[2] || '').toLowerCase() } : null;
    }
    function apply(name) {
      var hit = selection(); if (!hit) return;
      var next = '@' + name + ' ';
      el.value = el.value.slice(0, hit.at) + next + el.value.slice(hit.start);
      var pos = hit.at + next.length; el.setSelectionRange(pos, pos); close(); el.focus();
    }
    function show() {
      var hit = selection(); close(); if (!hit) return;
      var candidates = [{ username: 'everyone', display_name: '@everyone' }].concat((state.memberRows || []).filter(function(profile){ return !isDeleted(profile); })).filter(function(profile, index, rows){
        var username = String(profile.username || '').toLowerCase(), display = String(profile.display_name || '').toLowerCase();
        return (username.indexOf(hit.query) !== -1 || display.indexOf(hit.query) !== -1) && rows.findIndex(function(other){ return String(other.username || '').toLowerCase() === username; }) === index;
      }).slice(0, 6);
      if (!candidates.length) return;
      var box = document.createElement('div'); box.id = 'community-mention-menu'; box.className = 'community-mention-menu';
      box.innerHTML = candidates.map(function(profile){ var name = profile.username || 'everyone'; return '<button type="button" data-mention="' + esc(name) + '"><b>@' + esc(name) + '</b><small>' + esc(profile.display_name || name) + '</small></button>'; }).join('');
      document.body.appendChild(box);
      var rect = el.getBoundingClientRect(); box.style.left = Math.max(8, rect.left) + 'px'; box.style.top = Math.max(8, rect.top - box.offsetHeight - 6) + 'px';
      Array.prototype.forEach.call(box.querySelectorAll('[data-mention]'), function(button){ button.onclick = function(){ apply(button.dataset.mention); }; });
    }
    el.addEventListener('input', show);
    el.addEventListener('keydown', function(e){
      if (e.key === 'Tab') { var first = menu() && menu().querySelector('[data-mention]'); if (first) { e.preventDefault(); apply(first.dataset.mention); } }
      if (e.key === 'Escape') close();
    });
    el.addEventListener('blur', function(){ setTimeout(close, 120); });
  }
  function currentSettingsText() { var keys = ['activeCursor','cloakTitle','cloakFavicon','uzRememberMe','panicEnabled','panicKey','startupLoadingEnabled','loadingScreenEnabled','openGamesInBlob','hiddenPageCover']; var out = keys.map(function(k){ return k + ': ' + (localStorage.getItem(k) || ''); }).join('\n'); return 'Settings preset from ' + displayName() + '\n```\n' + out + '\n```'; }
  function appendPostText(text) { var body = $('community-post-body'); if (!body) return; body.value = (body.value ? body.value + '\n\n' : '') + text; body.focus(); }
  function attachSettingsPreset() { appendPostText(currentSettingsText()); status('Settings preset added.'); }
  function fileToImageAttachment(file) {
    if (!file) return Promise.resolve(null);
    if (!/^image\//i.test(file.type || '')) {
      if (file.size > 350000) return Promise.reject(new Error('Files must be below 350 KB. Images can be up to 8 MB and are compressed automatically.'));
      return new Promise(function(resolve, reject) {
        var reader = new FileReader();
        reader.onerror = function(){ reject(new Error('The file could not be read.')); };
        reader.onload = function(){ resolve({ name: String(file.name || 'file').slice(0, 120), type: file.type || 'application/octet-stream', data_url: String(reader.result || ''), size: file.size || 0 }); };
        reader.readAsDataURL(file);
      });
    }
    if (file.size > 8 * 1024 * 1024) return Promise.reject(new Error('That image is too large. Choose one below 8 MB.'));
    return new Promise(function(resolve, reject) {
      var reader = new FileReader();
      reader.onerror = function(){ reject(new Error('The image could not be read.')); };
      reader.onload = function(){
        var original = String(reader.result || '');
        if (original.length <= 500000) { resolve({ name: String(file.name || 'image').slice(0, 120), type: file.type || 'image/*', data_url: original }); return; }
        var image = new Image();
        image.onerror = function(){ reject(new Error('The image could not be prepared.')); };
        image.onload = function(){
          var edge = Math.min(1024, Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height));
          var attempt = 0;
          function encode() {
            var scale = Math.min(1, edge / Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height));
            var width = Math.max(1, Math.round((image.naturalWidth || image.width) * scale));
            var height = Math.max(1, Math.round((image.naturalHeight || image.height) * scale));
            var canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
            canvas.getContext('2d').drawImage(image, 0, 0, width, height);
            var data = canvas.toDataURL('image/jpeg', Math.max(.55, .88 - attempt * .08));
            if (data.length <= 500000) { resolve({ name: String(file.name || 'image').slice(0, 120), type: 'image/jpeg', data_url: data }); return; }
            attempt++; edge = Math.round(edge * .72);
            if (attempt > 4 || edge < 128) { reject(new Error('That image is still too large after resizing.')); return; }
            encode();
          }
          encode();
        };
        image.src = original;
      };
      reader.readAsDataURL(file);
    });
  }
  function showAttachmentChoice(id, attachment) { var el = $(id); if (el) el.textContent = attachment ? 'Ready: ' + attachmentName(attachment) : 'No file selected'; }
  function showAttachmentQueue(id, attachments) { var el = $(id); if (!el) return; var count = (attachments || []).length; el.textContent = count ? count + ' of ' + MAX_ATTACHMENTS + ' files ready' : 'No files selected'; }
  async function queueAttachments(files, stateKey, choiceId) {
    var nextFiles = Array.prototype.slice.call(files || []);
    var queue = state[stateKey] || [];
    if (!nextFiles.length) return;
    if (queue.length + nextFiles.length > MAX_ATTACHMENTS) throw new Error('You can attach up to ' + MAX_ATTACHMENTS + ' files at once.');
    for (var i = 0; i < nextFiles.length; i++) queue.push(await fileToImageAttachment(nextFiles[i]));
    state[stateKey] = queue;
    showAttachmentQueue(choiceId, queue);
  }
  async function createFirebaseItemWithAttachments(collection, record, attachments) {
    var files = (attachments || []).slice(0, MAX_ATTACHMENTS);
    var ref = await state.client.db.collection(collection).add(Object.assign({}, record, { attachment_count: 0 }));
    if (!files.length) return ref;
    try {
      var batch = state.client.db.batch();
      files.forEach(function(attachment, index) {
        batch.set(ref.collection('attachments').doc(), Object.assign({}, attachment, { sort_index: index, created_at: new Date().toISOString() }));
      });
      batch.update(ref, { attachment_count: files.length });
      await batch.commit();
      return ref;
    } catch (error) {
      try { await ref.delete(); } catch (cleanupError) {}
      throw error;
    }
  }
  async function loadFirebaseAttachments(collection, rows) {
    await Promise.all((rows || []).filter(function(row){ return Number(row.attachment_count || 0) > 0; }).map(async function(row) {
      try {
        var snapshot = await state.client.db.collection(collection).doc(String(row.id)).collection('attachments').orderBy('sort_index', 'asc').limit(MAX_ATTACHMENTS).get();
        row.attachments = snapshot.docs.map(function(doc){ return doc.data() || {}; });
      } catch (error) {
        row.attachments = [];
        console.warn('Could not load attachments for ' + collection + '/' + row.id, error);
      }
    }));
  }
  async function attachFileToPost(e) { try { state.pendingPostAttachment = await fileToImageAttachment(e && e.target && e.target.files ? e.target.files[0] : null); showAttachmentChoice('community-file-choice', state.pendingPostAttachment); status('File attached. It will be published separately from the post text.'); } catch (error) { state.pendingPostAttachment = null; showAttachmentChoice('community-file-choice', null); status(error.message || 'File upload failed.'); } }
  async function attachFileToChat(e) { try { await queueAttachments(e && e.target && e.target.files, 'pendingChatAttachments', 'community-chat-file-choice'); if (e && e.target) e.target.value = ''; status('Files attached to this message.'); } catch (error) { status(error.message || 'File upload failed.'); } }
  function renderVoiceRoom() {
    var list = $('community-list');
    if (!list) return;
    var joined = localStorage.getItem('uzVoiceJoined') === '1';
    var muted = localStorage.getItem('uzVoiceMuted') === '1';
    var deafened = localStorage.getItem('uzVoiceDeafened') === '1';
    var online = (state.memberRows || []).filter(isOnline);
    var names = online.map(function(m){ return '<span class="community-voice-pill">' + esc(m.display_name || m.username || 'member') + '</span>'; }).join('') || '<span class="community-voice-empty">Nobody else is showing online yet.</span>';
    list.innerHTML = '<div class="community-voice-room"><h3>Voice Lounge</h3><p>Mic controls work in this browser. Live cross-device talking still needs a WebRTC signaling server.</p><div class="community-voice-status ' + (joined ? 'is-joined' : '') + '">' + (joined ? 'You are in voice' + (muted ? ' / muted' : '') + (deafened ? ' / deafened' : '') + '.' : 'You are not in voice.') + '</div><div class="community-voice-members">' + names + '</div><div class="community-row"><button class="community-btn" id="community-voice-toggle" type="button">' + (joined ? 'Leave voice' : 'Join voice') + '</button><button class="community-btn secondary" id="community-voice-mute" type="button"' + (!joined ? ' disabled' : '') + '>' + (muted ? 'Unmute' : 'Mute') + '</button><button class="community-btn secondary" id="community-voice-deafen" type="button"' + (!joined ? ' disabled' : '') + '>' + (deafened ? 'Undeafen' : 'Deafen') + '</button></div></div>';
    var btn = $('community-voice-toggle');
    if (btn) btn.onclick = async function(){ if (!joined && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) { try { var stream = await navigator.mediaDevices.getUserMedia({ audio: true }); window.uzVoiceStream = stream; stream.getAudioTracks().forEach(function(t){ t.enabled = !muted; }); } catch(e) { status('Microphone blocked or unavailable.'); return; } } if (joined && window.uzVoiceStream) { window.uzVoiceStream.getTracks().forEach(function(t){ t.stop(); }); window.uzVoiceStream = null; } localStorage.setItem('uzVoiceJoined', joined ? '0' : '1'); renderVoiceRoom(); };
    var mute = $('community-voice-mute'); if (mute) mute.onclick = function(){ localStorage.setItem('uzVoiceMuted', muted ? '0' : '1'); if (window.uzVoiceStream) window.uzVoiceStream.getAudioTracks().forEach(function(t){ t.enabled = muted; }); renderVoiceRoom(); };
    var deafen = $('community-voice-deafen'); if (deafen) deafen.onclick = function(){ localStorage.setItem('uzVoiceDeafened', deafened ? '0' : '1'); renderVoiceRoom(); };
  }
  function ensureCommunityTools() {
    var shell = document.querySelector('.community-discord-shell');
    if (!shell || document.getElementById('community-pop-tools')) return;
    var tools = document.createElement('div');
    tools.id = 'community-pop-tools';
    tools.className = 'community-pop-tools';
    tools.innerHTML = '<button class="community-btn secondary" id="community-expand-toggle" type="button">Expand</button><button class="community-btn secondary" id="community-go-top" type="button">Top</button><button class="community-btn secondary" id="community-go-bottom" type="button">Bottom</button>';
    shell.insertBefore(tools, shell.firstChild);
    document.getElementById('community-expand-toggle').onclick = function(){ document.body.classList.toggle('community-expanded'); this.textContent = document.body.classList.contains('community-expanded') ? 'Shrink' : 'Expand'; };
    document.getElementById('community-go-top').onclick = function(){ var list = $('community-list'); if (list) list.scrollTo({ top: 0, behavior: 'smooth' }); };
    document.getElementById('community-go-bottom').onclick = function(){ var list = $('community-list'); if (list) list.scrollTo({ top: list.scrollHeight, behavior: 'smooth' }); };
  }
  function renderChannelHeader() { var head = $('community-channel-head'); var c = channelInfo[state.channelName] || channelInfo.chat; if (head) head.innerHTML = '<h3># ' + esc(c.title) + '</h3><p>' + esc(c.note) + '</p>'; }
  function setTab(tab, channel) {
    state.tab = tab || 'chat'; state.channelName = channel || (tab === 'chat' ? 'chat' : state.channelName || 'chat');
    Array.prototype.forEach.call(document.querySelectorAll('.community-tab'), function(btn){ var active = btn.dataset.communityChannel === state.channelName; btn.classList.toggle('active', active); btn.classList.toggle('secondary', !active); });
    renderChannelHeader(); renderComposer(); loadItems(); subscribe();
  }
  function announcementCard(row) {
    var p = row.profiles || {};
    var edit = canEditPost(row) ? '<button class="community-btn secondary community-edit-announcement" data-post-id="' + esc(row.id) + '">Edit</button>' : '';
    var del = canDeletePost(row) ? '<button class="community-btn secondary community-delete-announcement" data-post-id="' + esc(row.id) + '">Delete</button>' : '';
    return '<article class="announcement-card" data-announcement-id="' + esc(row.id) + '"><h3>' + esc(stripPostChannel(row.title || 'Announcement')) + '</h3><div class="announcement-meta">' + authorLabel(p, row) + ' / ' + esc(p.role || 'staff') + ' / ' + esc(when(row.created_at)) + '</div><div class="announcement-body">' + renderRichBody(row.body || '', row.attachments || row.attachment) + '</div><div class="community-actions"><button class="community-btn secondary community-copy-announcement" data-post-id="' + esc(row.id) + '">Copy</button>' + edit + del + '</div></article>';
  }
  function renderAnnouncementRows(rows) {
    var list = $('announcements-list');
    if (!list) return;
    list.innerHTML = rows.map(announcementCard).join('') || '<div class="community-message">No announcements yet.</div>';
    Array.prototype.forEach.call(document.querySelectorAll('.community-copy-announcement'), function(btn){ btn.onclick = function(){ var row = postById(rows, btn.dataset.postId); if (!row) return; navigator.clipboard.writeText(stripPostChannel(row.title || '') + '\n\n' + (row.body || '')).then(function(){ notifySaved('Announcement copied'); }).catch(function(){ status('Could not copy announcement.'); }); }; });
    wireAnnouncementActionsV2(rows);
  }
  function announcementComposerMarkup() {
    return '<input id="announcement-title" maxlength="120" placeholder="Announcement title"><textarea id="announcement-body" maxlength="7000" placeholder="Announcement text, links, files, or @everyone. Type @eve then Tab."></textarea><div class="announcement-composer-actions"><label class="community-file-label">Upload files<input id="announcement-file-input" type="file" multiple></label><span class="community-attachment-choice" id="announcement-file-choice">No files selected</span><button class="community-btn" id="announcement-send" type="button">Publish announcement</button></div>';
  }
  function renderAnnouncementComposerV2() {
    var compose = $('announcements-compose');
    if (!compose) return;
    if (!(state.user && isStaff())) { compose.innerHTML = '<div class="community-message community-locked">Mod, admin, or owner required to publish announcements.</div>'; return; }
    compose.innerHTML = announcementComposerMarkup();
    showAttachmentQueue('announcement-file-choice', state.pendingAnnouncementAttachments);
    var file = $('announcement-file-input'); if (file) file.onchange = attachAnnouncementFileV2;
    var send = $('announcement-send'); if (send) send.onclick = publishAnnouncementV2;
    wireMentionComplete($('announcement-body'));
  }
  async function publishAnnouncementV2() {
    var title = String(($('announcement-title') || {}).value || '').trim();
    var body = String(($('announcement-body') || {}).value || '').trim();
    var attachments = state.pendingAnnouncementAttachments || [];
    if (!title || (!body && !attachments.length)) { status('Add a title and either text or a file.'); return; }
    if (hasBadWord(title + ' ' + body)) { status('Blocked word found. Announcement will not publish.'); return; }
    if (/@(?:everyone|here)\b/i.test(title + ' ' + body) && !canBroadcastMention()) { status('@everyone and @here are restricted to admins and above.'); return; }
    var record = { title: '[announcements] ' + title, body: body };
    try {
      initClient();
      if (firebaseMode) {
        record.user_id = state.user.id; record.username = profileUsername(); record.created_at = new Date().toISOString();
        await createFirebaseItemWithAttachments('posts', record, attachments);
      } else if (mongoMode) {
        await mongoFetch('/posts', { method: 'POST', body: JSON.stringify(record) });
      } else {
        if (attachments.length) throw new Error('Attachments require the Firebase account database.');
        var result = await state.client.from('posts').insert({ user_id: state.user.id, title: record.title, body: record.body });
        if (result.error) throw result.error;
      }
      state.pendingAnnouncementAttachments = [];
      showAttachmentQueue('announcement-file-choice', []);
      audit('announcement', title);
      if (/@everyone\b/i.test(title + ' ' + body)) pingEveryone(title);
      notifySaved('Announcement posted');
      await renderAnnouncementsPanelV2();
    } catch (error) { status(error.message || 'Announcement could not be published.'); }
  }
  async function attachAnnouncementFileV2(e) {
    try {
      await queueAttachments(e && e.target && e.target.files, 'pendingAnnouncementAttachments', 'announcement-file-choice');
      if (e && e.target) e.target.value = '';
      status('Files attached. They will be shown under the announcement text.');
    } catch (error) {
      showAttachmentQueue('announcement-file-choice', state.pendingAnnouncementAttachments);
      status(error.message || 'File upload failed.');
    }
  }
  function announcementEditorMarkup(row, attachment) {
    var attachmentNote = attachment ? 'File: ' + attachmentName(attachment) : 'No file selected';
    var remove = attachment ? '<button class="community-btn secondary announcement-edit-remove-image" type="button">Remove file</button>' : '';
    return '<div class="announcement-edit-form"><input class="announcement-edit-title" maxlength="120" value="' + esc(stripPostChannel(row.title || '')) + '" aria-label="Announcement title"><textarea class="announcement-edit-body" maxlength="7000" aria-label="Announcement text">' + esc(row.body || '') + '</textarea><div class="announcement-edit-actions"><label class="community-file-label">Replace file<input class="announcement-edit-file" type="file"></label><span class="community-attachment-choice announcement-edit-choice">' + esc(attachmentNote) + '</span>' + remove + '<button class="community-btn announcement-edit-save" type="button">Save changes</button><button class="community-btn secondary announcement-edit-cancel" type="button">Cancel</button></div></div>';
  }
  function beginAnnouncementEdit(row) {
    var card = Array.prototype.filter.call(document.querySelectorAll('.announcement-card'), function(el){ return String(el.dataset.announcementId) === String(row.id); })[0];
    if (!card) return;
    var id = String(row.id);
    state.pendingAnnouncementEdits[id] = row.attachment || null;
    card.innerHTML = announcementEditorMarkup(row, state.pendingAnnouncementEdits[id]);
    var input = card.querySelector('.announcement-edit-file');
    if (input) input.onchange = async function(e) { try { state.pendingAnnouncementEdits[id] = await fileToImageAttachment(e.target.files && e.target.files[0]); card.querySelector('.announcement-edit-choice').textContent = 'Ready: ' + attachmentName(state.pendingAnnouncementEdits[id]); var remove = card.querySelector('.announcement-edit-remove-image'); if (!remove) { remove = document.createElement('button'); remove.type = 'button'; remove.className = 'community-btn secondary announcement-edit-remove-image'; remove.textContent = 'Remove file'; card.querySelector('.announcement-edit-actions').insertBefore(remove, card.querySelector('.announcement-edit-save')); remove.onclick = function(){ state.pendingAnnouncementEdits[id] = null; card.querySelector('.announcement-edit-choice').textContent = 'No file selected'; remove.remove(); }; } } catch(error) { status(error.message || 'File upload failed.'); } };
    var remove = card.querySelector('.announcement-edit-remove-image'); if (remove) remove.onclick = function(){ state.pendingAnnouncementEdits[id] = null; card.querySelector('.announcement-edit-choice').textContent = 'No file selected'; remove.remove(); };
    card.querySelector('.announcement-edit-cancel').onclick = function(){ delete state.pendingAnnouncementEdits[id]; renderAnnouncementsPanelV2(); };
    card.querySelector('.announcement-edit-save').onclick = async function(){
      var title = card.querySelector('.announcement-edit-title').value.trim();
      var body = card.querySelector('.announcement-edit-body').value.trim();
      var attachment = state.pendingAnnouncementEdits[id];
      if (!title || (!body && !attachment)) { status('Add a title and either text or a file.'); return; }
      if (hasBadWord(title + ' ' + body)) { status('Blocked word found. Announcement will not save.'); return; }
      try {
        initClient();
        var changes = { title: '[announcements] ' + title, body: body, attachment: attachment || null, updated_at: new Date().toISOString() };
        if (firebaseMode) await state.client.db.collection('posts').doc(id).set(changes, { merge: true });
        else if (mongoMode) await mongoFetch('/posts/' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify(changes) });
        else { if (attachment) throw new Error('Image attachments require the Firebase account database.'); var result = await state.client.from('posts').update({ title: changes.title, body: changes.body, updated_at: changes.updated_at }).eq('id', id); if (result.error) throw result.error; }
        delete state.pendingAnnouncementEdits[id]; audit('announcement-edit', id); notifySaved('Announcement updated'); await renderAnnouncementsPanelV2();
      } catch(error) { status(error.message || 'Announcement edit failed.'); }
    };
  }
  function wireAnnouncementActionsV2(rows) {
    Array.prototype.forEach.call(document.querySelectorAll('.community-edit-announcement'), function(btn){ btn.onclick = function(){ var row = postById(rows, btn.dataset.postId); if (row && canEditPost(row)) beginAnnouncementEdit(row); }; });
    Array.prototype.forEach.call(document.querySelectorAll('.community-delete-announcement'), function(btn){ btn.onclick = async function(){ var row = postById(rows, btn.dataset.postId); if (!row || !canDeletePost(row) || !confirm('Delete this announcement?')) return; try { initClient(); if (firebaseMode) await state.client.db.collection('posts').doc(String(row.id)).delete(); else if (mongoMode) await mongoFetch('/posts/' + encodeURIComponent(row.id), { method: 'DELETE' }); else { var result = await state.client.from('posts').delete().eq('id', row.id); if (result.error) throw result.error; } if (window.UZNotify && window.UZNotify.removeText) window.UZNotify.removeText('@everyone: ' + stripPostChannel(row.title || '')); audit('announcement-delete', row.id); notifySaved('Announcement deleted'); await renderAnnouncementsPanelV2(); } catch(error) { status(error.message || 'Announcement delete failed.'); } }; });
  }
  async function renderAnnouncementsPanelV2() {
    var list = $('announcements-list');
    if (!list) return;
    if (!ready) { list.innerHTML = '<div class="community-message community-locked">Live database is not connected yet.</div>'; return; }
    try {
      initClient();
      var rows;
      if (mongoMode) rows = ((await mongoFetch('/posts')).posts || []).map(mongoPost);
      else if (firebaseMode) {
        var snapshot = await state.client.db.collection('posts').orderBy('created_at', 'desc').limit(60).get();
        rows = snapshot.docs.map(firebaseRow);
        if (!state.memberRows.length) await loadMembers(false);
        state.profileByUser = {}; (state.memberRows || []).forEach(function(p){ state.profileByUser[String(p.id)] = p; });
        rows.forEach(function(row){ row.profiles = state.profileByUser[String(row.user_id)] || { username: row.username, display_name: row.username, role: 'staff' }; });
      } else {
        var response = await state.client.from('posts').select('*, profiles(' + profileFields() + ', email)').order('created_at', { ascending: false }).limit(60);
        if (response.error) throw response.error;
        rows = response.data || [];
      }
      rows = (rows || []).filter(function(row){ return !row.deleted_at && normalizePostChannel(row.title) === 'announcements'; });
      if (firebaseMode) await loadFirebaseAttachments('posts', rows);
      renderAnnouncementRows(rows); renderAnnouncementComposerV2();
    } catch(error) { list.innerHTML = '<div class="community-message community-locked">' + esc(error.message || 'Announcements could not load.') + '</div>'; var compose = $('announcements-compose'); if (compose) compose.innerHTML = ''; }
  }
  async function renderAnnouncementsPanel() {
    return renderAnnouncementsPanelV2();
    var list = $('announcements-list'), compose = $('announcements-compose');
    if (!list) return;
    if (!ready) { list.innerHTML = '<div class="community-message community-locked">Live database is not connected yet.</div>'; return; }
    if (mongoMode) {
      try {
        var data = await mongoFetch('/posts');
        var rows = (data.posts || []).map(mongoPost).filter(function(row){ return !row.deleted_at && normalizePostChannel(row.title) === 'announcements'; });
        list.innerHTML = rows.map(function(row){ var p = row.profiles || {}; var edit = canEditPost(row) ? '<button class="community-btn secondary community-edit-announcement" data-post-id="' + esc(row.id) + '">Edit</button>' : ''; var del = canDeletePost(row) ? '<button class="community-btn secondary community-delete-announcement" data-post-id="' + esc(row.id) + '">Delete</button>' : ''; return '<article class="announcement-card"><h3>' + esc(stripPostChannel(row.title || 'Announcement')) + '</h3><div class="announcement-meta">' + authorLabel(p, row) + ' / ' + esc(when(row.created_at)) + '</div><div class="announcement-body">' + renderRichBody(row.body || '') + '</div><div class="community-actions"><button class="community-btn secondary community-copy-announcement" data-post-id="' + esc(row.id) + '">Copy</button>' + edit + del + '</div></article>'; }).join('') || '<div class="community-message">No announcements yet.</div>';
        Array.prototype.forEach.call(document.querySelectorAll('.community-copy-announcement'), function(btn){ btn.onclick = function(){ var row = rows.filter(function(r){ return String(r.id) === String(btn.dataset.postId); })[0]; if (!row) return; navigator.clipboard.writeText(stripPostChannel(row.title || '') + '\n\n' + (row.body || '')); notifySaved('Announcement copied'); }; }); wireAnnouncementActions(rows);
        if (compose) {
          var ok = state.user && isStaff();
          compose.innerHTML = ok ? '<input id="announcement-title" maxlength="120" placeholder="Announcement title"><textarea id="announcement-body" maxlength="7000" placeholder="Announcement text, links, files, or @everyone. Type @eve then Tab."></textarea><details class="announcement-file-drop"><summary>Files</summary><label class="community-file-label">Browse file<input id="announcement-file-input" type="file"></label></details><button class="community-btn" id="announcement-send" type="button">Publish announcement</button>' : '<div class="community-message community-locked">Mod, admin, or owner required to publish announcements.</div>';
          var file = $('announcement-file-input'); if (file) file.onchange = attachAnnouncementFile;
          var send = $('announcement-send'); if (send) send.onclick = async function(){ var title = ($('announcement-title').value || '').trim(); var body = ($('announcement-body').value || '').trim(); if (!title || !body) return; if (hasBadWord(title + ' ' + body)) { status('Blocked word found. Announcement will not publish.'); return; } try { await mongoFetch('/posts', { method: 'POST', body: JSON.stringify({ title: '[announcements] ' + title, body: body }) }); audit('announcement', title); if (/@everyone\b/i.test(body + ' ' + title)) pingEveryone(title); notifySaved('Announcement posted'); renderAnnouncementsPanel(); } catch(e) { status(e.message); } };
        }
      } catch(e) { list.innerHTML = '<div class="community-message community-locked">' + esc(e.message) + '</div>'; if (compose) compose.innerHTML = ''; }
      return;
    }
    initClient();
    if (firebaseMode) {
      try {
        var snap = await state.client.db.collection('posts').orderBy('created_at', 'desc').limit(60).get();
        var rows = snap.docs.map(firebaseRow).filter(function(row){ return !row.deleted_at && normalizePostChannel(row.title) === 'announcements'; });
        if (!state.memberRows.length) await loadMembers(false);
        state.profileByUser = {}; (state.memberRows || []).forEach(function(p){ state.profileByUser[String(p.id)] = p; });
        rows.forEach(function(row){ row.profiles = state.profileByUser[String(row.user_id)] || { username: row.username, display_name: row.username, role: 'staff' }; });
        list.innerHTML = rows.map(function(row){ var p = row.profiles || {}; var edit = canEditPost(row) ? '<button class="community-btn secondary community-edit-announcement" data-post-id="' + esc(row.id) + '">Edit</button>' : ''; var del = canDeletePost(row) ? '<button class="community-btn secondary community-delete-announcement" data-post-id="' + esc(row.id) + '">Delete</button>' : ''; return '<article class="announcement-card"><h3>' + esc(stripPostChannel(row.title || 'Announcement')) + '</h3><div class="announcement-meta">' + authorLabel(p, row) + ' / ' + esc(p.role || 'staff') + ' / ' + esc(when(row.created_at)) + '</div><div class="announcement-body">' + renderRichBody(row.body || '') + '</div><div class="community-actions"><button class="community-btn secondary community-copy-announcement" data-post-id="' + esc(row.id) + '">Copy</button>' + edit + del + '</div></article>'; }).join('') || '<div class="community-message">No announcements yet.</div>';
        Array.prototype.forEach.call(document.querySelectorAll('.community-copy-announcement'), function(btn){ btn.onclick = function(){ var row = rows.filter(function(r){ return String(r.id) === String(btn.dataset.postId); })[0]; if (!row) return; navigator.clipboard.writeText(stripPostChannel(row.title || '') + '\n\n' + (row.body || '')); notifySaved('Announcement copied'); }; }); wireAnnouncementActions(rows);
        if (compose) {
          var ok = state.user && isStaff();
          compose.innerHTML = ok ? '<input id="announcement-title" maxlength="120" placeholder="Announcement title"><textarea id="announcement-body" maxlength="7000" placeholder="Announcement text, links, files, or @everyone. Type @eve then Tab."></textarea><details class="announcement-file-drop"><summary>Files</summary><label class="community-file-label">Browse file<input id="announcement-file-input" type="file"></label></details><button class="community-btn" id="announcement-send" type="button">Publish announcement</button>' : '<div class="community-message community-locked">Mod, admin, or owner required to publish announcements.</div>';
          var f = $('announcement-file-input'); if (f) f.onchange = attachAnnouncementFile;
          var s = $('announcement-send'); if (s) s.onclick = async function(){ var title = ($('announcement-title').value || '').trim(); var body = ($('announcement-body').value || '').trim(); if (!title || !body) return; if (hasBadWord(title + ' ' + body)) { status('Blocked word found. Announcement will not publish.'); return; } try { await state.client.db.collection('posts').add({ user_id: state.user.id, username: profileUsername(), title: '[announcements] ' + title, body: body, created_at: new Date().toISOString() }); audit('announcement', title); if (/@everyone\b/i.test(body + ' ' + title)) pingEveryone(title); notifySaved('Announcement posted'); renderAnnouncementsPanel(); } catch(e) { status(e.message); } };
        }
      } catch(e) { list.innerHTML = '<div class="community-message community-locked">' + esc(e.message) + '</div>'; if (compose) compose.innerHTML = ''; }
      return;
    }
    var res = await state.client.from('posts').select('*, profiles(' + profileFields() + ', email)').order('created_at', { ascending: false }).limit(60);
    if (res.error && handleProfileError(res.error)) res = await state.client.from('posts').select('*, profiles(' + profileFields() + ', email)').order('created_at', { ascending: false }).limit(60);
    if (res.error) { list.innerHTML = '<div class="community-message community-locked">' + esc(res.error.message) + '</div>'; return; }
    var rows = (res.data || []).filter(function(row){ return !row.deleted_at && normalizePostChannel(row.title) === 'announcements'; });
    list.innerHTML = rows.map(function(row){ var p = row.profiles || {}; var edit = canEditPost(row) ? '<button class="community-btn secondary community-edit-announcement" data-post-id="' + esc(row.id) + '">Edit</button>' : ''; var del = canDeletePost(row) ? '<button class="community-btn secondary community-delete-announcement" data-post-id="' + esc(row.id) + '">Delete</button>' : ''; return '<article class="announcement-card"><h3>' + esc(stripPostChannel(row.title || 'Announcement')) + '</h3><div class="announcement-meta">' + authorLabel(p, row) + ' / ' + esc(p.role || 'staff') + ' / ' + esc(when(row.created_at)) + '</div><div class="announcement-body">' + renderRichBody(row.body || '') + '</div><div class="community-actions"><button class="community-btn secondary community-copy-announcement" data-post-id="' + esc(row.id) + '">Copy</button>' + edit + del + '</div></article>'; }).join('') || '<div class="community-message">No announcements yet.</div>';
    Array.prototype.forEach.call(document.querySelectorAll('.community-copy-announcement'), function(btn){ btn.onclick = function(){ var row = rows.filter(function(r){ return String(r.id) === String(btn.dataset.postId); })[0]; if (!row) return; navigator.clipboard.writeText(stripPostChannel(row.title || '') + '\n\n' + (row.body || '')); notifySaved('Announcement copied'); }; }); wireAnnouncementActions(rows);
    if (compose) {
      var ok = state.user && isStaff();
      compose.innerHTML = ok ? '<input id="announcement-title" maxlength="120" placeholder="Announcement title"><textarea id="announcement-body" maxlength="7000" placeholder="Announcement text, links, files, or @everyone. Type @eve then Tab."></textarea><details class="announcement-file-drop"><summary>Files</summary><label class="community-file-label">Browse file<input id="announcement-file-input" type="file"></label></details><button class="community-btn" id="announcement-send" type="button">Publish announcement</button>' : '<div class="community-message community-locked">Mod, admin, or owner required to publish announcements.</div>';
      var file = $('announcement-file-input'); if (file) file.onchange = attachAnnouncementFile;
      var send = $('announcement-send'); if (send) send.onclick = async function(){ var title = ($('announcement-title').value || '').trim(); var body = ($('announcement-body').value || '').trim(); if (!title || !body) return; if (hasBadWord(title + ' ' + body)) { status('Blocked word found. Announcement will not publish.'); return; } var r = await state.client.from('posts').insert({ user_id: state.user.id, title: '[announcements] ' + title, body: body }); if (r.error) { status(r.error.message); return; } audit('announcement', title); if (/@everyone\b/i.test(body + ' ' + title)) pingEveryone(title); notifySaved('Announcement posted'); renderAnnouncementsPanel(); };
    }
  }
  function normalizePostChannel(title) { var m = String(title || '').match(/^\[([^\]]+)\]\s*/); return m ? m[1].toLowerCase() : 'announcements'; }
  async function editAnnouncement(row) { var title = prompt('Announcement title', stripPostChannel(row.title || '')); if (title == null) return; var body = prompt('Announcement body', row.body || ''); if (body == null) return; title = title.trim(); body = body.trim(); if (!title || !body) return; initClient(); var nextTitle = '[announcements] ' + title; if (firebaseMode) await state.client.db.collection('posts').doc(String(row.id)).set({ title: nextTitle, body: body, updated_at: new Date().toISOString() }, { merge: true }); else if (mongoMode) await mongoFetch('/posts/' + encodeURIComponent(row.id), { method: 'PATCH', body: JSON.stringify({ title: nextTitle, body: body }) }); else { var res = await state.client.from('posts').update({ title: nextTitle, body: body, updated_at: new Date().toISOString() }).eq('id', row.id); if (res.error) throw res.error; } audit('announcement-edit', row.id); notifySaved('Announcement updated'); renderAnnouncementsPanel(); }
  function wireAnnouncementActions(rows) { Array.prototype.forEach.call(document.querySelectorAll('.community-edit-announcement'), function(btn){ btn.onclick = async function(){ var row = postById(rows, btn.dataset.postId); if (!row || !canEditPost(row)) return; try { await editAnnouncement(row); } catch(e) { status(e.message || 'Announcement edit failed.'); } }; }); Array.prototype.forEach.call(document.querySelectorAll('.community-delete-announcement'), function(btn){ btn.onclick = async function(){ var row = postById(rows, btn.dataset.postId); if (!row || !canDeletePost(row) || !confirm('Delete this announcement?')) return; initClient(); try { if (firebaseMode) await state.client.db.collection('posts').doc(String(row.id)).delete(); else if (mongoMode) await mongoFetch('/posts/' + encodeURIComponent(row.id), { method: 'DELETE' }); else { var res = await state.client.from('posts').delete().eq('id', row.id); if (res.error) throw res.error; } if (window.UZNotify && window.UZNotify.removeText) window.UZNotify.removeText('@everyone: ' + stripPostChannel(row.title || '')); audit('announcement-delete', row.id); notifySaved('Announcement deleted'); renderAnnouncementsPanel(); } catch(e) { status(e.message || 'Announcement delete failed.'); } }; }); }
  function attachAnnouncementFile(e) { var file = e && e.target && e.target.files ? e.target.files[0] : null; var body = $('announcement-body'); if (!file || !body) return; if (file.size > 250000) { status('File is too large for inline sharing. Upload it somewhere and paste a link.'); return; } var reader = new FileReader(); reader.onload = function(){ body.value += (body.value ? '\n\n' : '') + 'Attached file: ' + file.name + '\n' + String(reader.result || '').slice(0, 12000); status('File attached.'); }; reader.readAsDataURL(file); }
  function stripPostChannel(title) { return String(title || '').replace(/^\[[^\]]+\]\s*/, ''); }
  async function loadItems() {
    var list = $('community-list'); if (!list) return; renderChannelHeader();
    if (firebaseMode && !firebaseAvailable()) { list.innerHTML = '<div class="community-message community-locked">Firebase is temporarily rate-limited. The countdown at the top shows when reads resume.</div>'; return; }
    if (state.tab === 'voice') { renderVoiceRoom(); loadMembers(false); return; }
    if (!ready) { list.innerHTML = '<div class="community-message community-locked">Live database is not connected yet. Check community/config.js.</div>'; return; }
    if (firebaseMode) {
      try {
        initClient();
        if (state.tab === 'members') { await loadMembers(true); return; }
        var collection = state.tab === 'chat' ? 'messages' : 'posts';
        var snap = await state.client.db.collection(collection).orderBy('created_at', 'desc').limit(100).get();
        var rows = snap.docs.map(firebaseRow).reverse().filter(function(row){ return !row.deleted_at || !!state.recentlyDeletedMessages[String(row.id)]; });
        if (state.tab === 'posts') rows = rows.filter(function(row){ return normalizePostChannel(row.title) === state.channelName; });
        await loadFirebaseAttachments(collection, rows);
        if (!state.memberRows.length) await loadMembers(false);
        state.profileByUser = {}; (state.memberRows || []).forEach(function(p){ state.profileByUser[String(p.id)] = p; });
        rows.forEach(function(r){ r.profiles = state.profileByUser[String(r.user_id)] || { username: r.username, display_name: r.username, role: 'member' }; });
        list.innerHTML = rows.map(renderItem).join('') || '<div class="community-message">Nothing here yet.</div>';
        if (state.tab === 'chat') wireMessageActions(rows); else wirePostActionsV2(rows);
        wireProfileLinks(); list.scrollTop = list.scrollHeight;
      } catch(e) { firebaseCooldown(e); list.innerHTML = '<div class="community-message community-locked">' + esc(e.message) + '</div>'; }
      return;
    }
    if (mongoMode) {
      try {
        if (state.tab === 'members') { await loadMembers(true); return; }
        var data = await mongoFetch(state.tab === 'chat' ? '/messages' : '/posts');
        var rows = state.tab === 'chat' ? (data.messages || []).map(mongoMessage).reverse().filter(function(row){ return !row.deleted_at || !!state.recentlyDeletedMessages[String(row.id)]; }) : (data.posts || []).map(mongoPost).reverse().filter(function(row){ return !row.deleted_at; });
        if (state.tab === 'posts') rows = rows.filter(function(row){ return normalizePostChannel(row.title) === state.channelName; });
        state.profileByUser = {}; (state.memberRows || []).forEach(function(p){ state.profileByUser[String(p.id)] = p; });
        list.innerHTML = rows.map(renderItem).join('') || '<div class="community-message">Nothing here yet.</div>';
        if (state.tab === 'chat') wireMessageActions(rows); else wirePostActionsV2(rows);
        wireProfileLinks(); list.scrollTop = list.scrollHeight; if (!state.memberRows.length) loadMembers(false);
      } catch(e) { list.innerHTML = '<div class="community-message community-locked">' + esc(e.message) + '</div>'; }
      return;
    }
    initClient();
    if (state.tab === 'members') { await loadMembers(true); return; }
    var table = state.tab === 'chat' ? 'chat_messages' : 'posts';
    var res = await state.client.from(table).select('*, profiles(' + profileFields() + ', email)').order('created_at', { ascending: false }).limit(100);
    if (res.error && handleProfileError(res.error)) { res = await state.client.from(table).select('*, profiles(' + profileFields() + ', email)').order('created_at', { ascending: false }).limit(100); }
    if (res.error) { list.innerHTML = '<div class="community-message community-locked">' + esc(res.error.message) + '</div>'; return; }
    var rows = (res.data || []).slice().reverse().filter(function(row){ return !row.deleted_at || !!state.recentlyDeletedMessages[String(row.id)]; });
    if (state.tab === 'posts') rows = rows.filter(function(row){ return normalizePostChannel(row.title) === state.channelName; });
    state.profileByUser = {}; rows.forEach(function(r){ if (r.profiles && r.user_id) state.profileByUser[String(r.user_id)] = r.profiles; });
    list.innerHTML = rows.map(renderItem).join('') || '<div class="community-message">Nothing here yet.</div>';
        if (state.tab === 'chat') wireMessageActions(rows); else wirePostActionsV2(rows);
    wireProfileLinks(); list.scrollTop = list.scrollHeight; if (!state.memberRows.length) loadMembers(false);
  }
  function metaEmail(p) { if (!isOwner() || !p.email) return ''; return ' / ' + esc(p.email); }
  function renderItem(row) {
    var p = row.profiles || {}; var name = p.display_name || p.username || row.username || 'Member'; var r = p.role || 'member';
    if (state.tab === 'posts') { var actions = '<div class="community-actions"><button class="community-btn secondary community-copy-post" data-post-id="' + esc(row.id) + '">Copy</button>'; if (canEditPost(row)) actions += '<button class="community-btn secondary community-edit-post" data-post-id="' + esc(row.id) + '">Edit</button>'; if (canDeletePost(row)) actions += '<button class="community-btn secondary community-delete-post" data-post-id="' + esc(row.id) + '">Delete</button>'; actions += '</div>'; return '<article class="community-post" data-post-id="' + esc(row.id) + '"><div class="community-meta"><button class="community-user-link" data-user-id="' + esc(row.user_id) + '">' + authorLabel(p, row) + '</button><span> / ' + esc(r) + metaEmail(p) + '</span><span>' + esc(when(row.created_at)) + '</span></div><h3>' + esc(stripPostChannel(row.title)) + '</h3><div class="community-body">' + renderRichBody(row.body, row.attachments || row.attachment) + '</div>' + actions + '</article>'; }
    var edited = row.updated_at && row.created_at && new Date(row.updated_at).getTime() - new Date(row.created_at).getTime() > 1000 ? '<span class="community-edited">edited</span>' : '';
    var deleted = row.deleted_at ? '<span class="community-deleted-tag">deleted</span>' : '';
    var bodyClass = row.deleted_at ? 'community-body community-deleted-body' : 'community-body';
    var body = row.deleted_at ? 'Deleted message: ' + (row.deleted_body || row.body || '') : row.body;
    var renderedBody = row.deleted_at ? esc(body) : renderRichBody(body, row.attachments || row.attachment);
    var chatActions = '<div class="community-actions">';
    if (canEditMessage(row)) chatActions += '<button class="community-btn secondary community-edit-message" data-message-id="' + esc(row.id) + '">Edit</button>';
    if (canDeleteMessage(row)) chatActions += '<button class="community-btn secondary community-delete-message" data-message-id="' + esc(row.id) + '">Delete</button>';
    chatActions += '</div>';
    return '<article class="community-message ' + (row.deleted_at ? 'is-deleted ' : '') + (/@(?:everyone|here|[a-z0-9_.-]+)\b/i.test(String(row.body || '')) ? 'has-mention' : '') + '" data-message-id="' + esc(row.id) + '"><div class="community-meta"><button class="community-user-link" data-user-id="' + esc(row.user_id) + '">' + authorLabel(p, row) + '</button><span> / ' + esc(r) + metaEmail(p) + ' ' + edited + deleted + '</span><span>' + esc(when(row.created_at)) + '</span></div><div class="' + bodyClass + '">' + renderedBody + '</div>' + chatActions + '</article>';
  }
  async function loadMembers(main) {
    if (!ready) return;
    if (firebaseMode) {
      try {
        initClient();
        var snap = await state.client.db.collection('profiles').limit(200).get();
        state.memberRows = snap.docs.map(function(doc){ return fromFirebaseProfile(doc.id, doc.data()); }).filter(function(profile){ return !isDeleted(profile); });
        var html = renderMembers(state.memberRows, main);
        if (main && $('community-list')) $('community-list').innerHTML = html || '<div class="community-message">No members yet.</div>';
        var side = $('community-side-members'); if (side) side.innerHTML = renderMembers(state.memberRows, false);
        wireMemberActions(); wireProfileLinks();
      } catch(e) { if (main && $('community-list')) $('community-list').innerHTML = '<div class="community-message community-locked">' + esc(e.message) + '</div>'; }
      return;
    }
    if (mongoMode) {
      try {
        var data = await mongoFetch('/members');
        state.memberRows = (data.members || []).map(fromMongoUser).filter(function(profile){ return !isDeleted(profile); });
        var html = renderMembers(state.memberRows, main);
        if (main && $('community-list')) $('community-list').innerHTML = html || '<div class="community-message">No members yet.</div>';
        var side = $('community-side-members'); if (side) side.innerHTML = renderMembers(state.memberRows, false);
        wireMemberActions(); wireProfileLinks();
      } catch(e) { if (main && $('community-list')) $('community-list').innerHTML = '<div class="community-message community-locked">' + esc(e.message) + '</div>'; }
      return;
    }
    initClient();
    var res = await state.client.from('profiles').select(profileFields()).order('role', { ascending: false }).limit(200);
    if (res.error && handleProfileError(res.error)) { res = await state.client.from('profiles').select(profileFields()).order('role', { ascending: false }).limit(200); }
    if (res.error) { if (main && $('community-list')) $('community-list').innerHTML = '<div class="community-message community-locked">' + esc(res.error.message) + '</div>'; return; }
    state.memberRows = (res.data || []).filter(function(profile){ return !isDeleted(profile); });
    var html = renderMembers(state.memberRows, main);
    if (main && $('community-list')) $('community-list').innerHTML = html || '<div class="community-message">No members yet.</div>';
    var side = $('community-side-members'); if (side) side.innerHTML = renderMembers(state.memberRows, false);
    wireMemberActions(); wireProfileLinks();
  }
  function renderMembers(rows, full) {
    var order = { owner: 0, co_owner: 1, admin: 2, mod: 3, member: 4, banned: 5 };
    rows = (rows || []).slice().sort(function(a,b){ return (order[a.role] || 9) - (order[b.role] || 9) || String(a.username || '').localeCompare(String(b.username || '')); });
    var groups = ['owner','co_owner','admin','mod','member','banned'];
    return groups.map(function(g){ var members = rows.filter(function(r){ return (r.role || 'member') === g; }); if (!members.length) return ''; return '<section class="community-member-group"><h3>' + esc(g.toUpperCase()) + ' - ' + members.length + '</h3>' + members.map(function(m){ var canChangeRole = full && isRealOwner() && (!state.user || String(m.id) !== String(state.user.id)); var online = isOnline(m); var statusText = online ? 'Online' : 'Offline'; var roleControl = canChangeRole ? '<select class="community-role-select" data-user-id="' + esc(m.id) + '" data-username="' + esc(m.username || '') + '"><option' + (m.role === 'owner' ? ' selected' : '') + '>owner</option><option' + (m.role === 'admin' ? ' selected' : '') + '>admin</option><option' + (m.role === 'mod' ? ' selected' : '') + '>mod</option><option' + ((m.role || 'member') === 'member' ? ' selected' : '') + '>member</option><option' + (m.role === 'banned' ? ' selected' : '') + '>banned</option></select>' : '<em>' + esc(m.role || 'member') + '</em>'; return '<article class="community-member-row ' + (online ? 'is-online' : 'is-offline') + (g === 'banned' ? ' is-banned-member' : '') + '"><span class="community-member-dot" title="' + esc(statusText) + '"></span>' + profileAvatarHtml(m) + '<button class="community-user-link community-member-name" data-user-id="' + esc(m.id) + '"><b>' + esc(m.display_name || m.username || 'member') + '</b><small>@' + esc(m.username || 'unknown') + ' - ' + statusText + '</small></button>' + roleControl + '</article>'; }).join('') + '</section>'; }).join('');
  }
  function wireAvatarPreviews(root) {
    (root || document).querySelectorAll('.community-profile-avatar[data-avatar-preview]').forEach(function(button){ button.onclick = function(event){ event.stopPropagation(); var existing = document.getElementById('community-avatar-lightbox'); if (existing) existing.remove(); var lightbox = document.createElement('div'); lightbox.id = 'community-avatar-lightbox'; lightbox.className = 'community-avatar-lightbox'; lightbox.innerHTML = '<button type="button" aria-label="Close image"><img src="' + esc(button.dataset.avatarPreview || '') + '" alt="Profile image"></button>'; document.body.appendChild(lightbox); lightbox.onclick = function(){ lightbox.remove(); }; }; });
  }
  function wireProfileLinks() { Array.prototype.forEach.call(document.querySelectorAll('.community-user-link'), function(btn){ btn.onclick = function(){ showCommunityProfile(btn.dataset.userId); }; }); wireAvatarPreviews(document); }
  function wireMemberActions() { Array.prototype.forEach.call(document.querySelectorAll('.community-role-select'), function(sel){ sel.onchange = async function(){ await changeUserRoleV2(sel.dataset.username, sel.value); }; }); ensureCoOwnerOptions(); }
  function ensureCoOwnerOptions() { Array.prototype.forEach.call(document.querySelectorAll('.community-role-select'), function(sel){ if (!sel.querySelector('option[value="co_owner"]')) { var option = document.createElement('option'); option.value = 'co_owner'; option.textContent = 'co_owner'; if (sel.dataset.currentRole === 'co_owner') option.selected = true; sel.insertBefore(option, sel.querySelector('option[value="admin"]')); } }); }
  async function firebaseFindUser(username) { initClient(); var snap = await state.client.db.collection('profiles').where('username', '==', String(username || '').toLowerCase()).limit(1).get(); if (snap.empty) return null; var doc = snap.docs[0]; return { id: doc.id, data: fromFirebaseProfile(doc.id, doc.data()), ref: state.client.db.collection('profiles').doc(doc.id) }; }
  async function changeUserRole(username, newRole) { if (!isRealOwner()) { status('A real owner account is required to change roles.'); return; } if (!username) return; if (state.profile && username.toLowerCase() === String(state.profile.username || '').toLowerCase()) { status('You cannot change your own role here.'); loadMembers(state.tab === 'members'); return; } if (firebaseMode) { try { var target = await firebaseFindUser(username); if (!target) { status('Target not found.'); return; } if (target.data.role === 'owner') { status('Owners cannot change other owners.'); return; } var set = { role: newRole }; if (newRole === 'banned') set.banned_until = '2099-01-01T00:00:00.000Z'; else set.banned_until = null; await target.ref.set(set, { merge: true }); notifySaved('Role updated'); await loadMembers(state.tab === 'members'); } catch(e) { status(e.message); } return; } if (mongoMode) { try { await mongoFetch('/staff/role', { method: 'POST', body: JSON.stringify({ username: username, role: newRole }) }); notifySaved('Role updated'); await loadMembers(state.tab === 'members'); } catch(e) { status(e.message); } return; } initClient(); var res = await state.client.rpc('set_user_role', { target_username: username, new_role: newRole }); if (res.error) { status(res.error.message); return; } notifySaved('Role updated'); await loadMembers(state.tab === 'members'); }
  async function changeUserRoleV2(username, newRole) {
    if (!firebaseMode) return changeUserRole(username, newRole);
    if (!isRealOwner()) { status('A real owner account is required to change roles.'); return; }
    if (!username) return;
    try {
      var target = await firebaseFindUser(username);
      if (!target) throw new Error('Target not found.');
      if (target.data.role === 'owner') throw new Error('Owners cannot change other owners.');
      var set = { role: newRole };
      if (newRole === 'banned') {
        var now = new Date().toISOString();
        set.banned_until = '2099-01-01T00:00:00.000Z'; set.banned_at = now; set.ban_id = now + ':' + target.id;
      } else { set.banned_until = null; set.banned_at = null; set.ban_id = null; }
      await target.ref.set(set, { merge: true });
      notifySaved('Role updated'); await loadMembers(state.tab === 'members');
    } catch (error) { status(error.message || 'Role update failed.'); }
  }
  function findProfile(userId) { return (state.memberRows || []).filter(function(m){ return String(m.id) === String(userId); })[0] || state.profileByUser[String(userId)] || {}; }
  function profileStatusHtml(p) {
    var banned = isBanned(p) || p.role === 'banned';
    var kicked = isKicked(p);
    var muted = isMuted(p);
    var label = banned ? 'BANNED' : (kicked ? 'KICKED' : (muted ? 'MUTED' : (isOnline(p) ? 'ONLINE' : 'OFFLINE')));
    var cls = banned ? 'is-banned' : (kicked ? 'is-kicked' : (muted ? 'is-muted' : (isOnline(p) ? 'is-online' : 'is-offline')));
    return '<p class="community-profile-status ' + cls + '">Status: <b>' + esc(label) + '</b></p>';
  }
  function profileRoleControl(p) {
    if (!isRealOwner() || !p.username || (state.user && String(p.id) === String(state.user.id))) return '<p>Role: <b>' + esc(p.role || 'member') + '</b></p>';
    var roles = isOwner() ? ['owner','co_owner','admin','mod','member','banned'] : ['co_owner','admin','mod','member','banned'];
    return '<label class="community-profile-role-label">Role<select id="community-profile-role">' + roles.map(function(r){ return '<option value="' + r + '"' + ((p.role || 'member') === r ? ' selected' : '') + '>' + r + '</option>'; }).join('') + '</select></label>';
  }
  function profileCommandButtons(p) {
    if (!p.username || !isStaff()) return '';
    var rr = role();
    var buttons = ['<button class="community-btn secondary community-profile-command" data-profile-cmd="warn">Warn</button>'];
    if (['owner','admin','mod'].indexOf(rr) !== -1) buttons.push('<button class="community-btn secondary community-profile-command" data-profile-cmd="mute">Mute</button><button class="community-btn secondary community-profile-command" data-profile-cmd="unmute">Unmute</button>');
    if (['owner','admin'].indexOf(rr) !== -1) buttons.push('<button class="community-btn secondary community-profile-command" data-profile-cmd="kick">Kick</button>');
    if (isRealSeniorStaff()) buttons.push('<button class="community-btn danger community-profile-command" data-profile-cmd="ban">Ban</button><button class="community-btn secondary community-profile-command" data-profile-cmd="unban">Unban</button><button class="community-btn danger community-profile-command" data-profile-cmd="deleteuser">Delete account</button>');
    return '<div class="community-profile-actions"><h3>Run command</h3><div class="community-profile-command-grid">' + buttons.join('') + '</div></div>';
  }
  function showCommunityProfile(userId) {
    var p = findProfile(userId); var existing = document.getElementById('community-profile-pop'); if (existing) existing.remove();
    var modal = document.createElement('div'); modal.id = 'community-profile-pop'; modal.className = 'community-profile-pop';
    var ban = p.banned_until && new Date(p.banned_until) > new Date() ? '<p>Banned until: <b>' + esc(when(p.banned_until)) + '</b></p>' : '';
    var kick = p.kicked_until && new Date(p.kicked_until) > new Date() ? '<p>Kicked until: <b>' + esc(when(p.kicked_until)) + '</b></p>' : '';
    var mute = p.muted_until && new Date(p.muted_until) > new Date() ? '<p>Muted until: <b>' + esc(when(p.muted_until)) + '</b></p>' : '';
    modal.innerHTML = '<div class="community-profile-card"><button class="uz-profile-modal-close" id="community-profile-close">Close</button><div class="community-profile-heading">' + profileAvatarHtml(p, 'large') + '<h2>' + esc(p.display_name || p.username || 'Member') + '</h2></div><p>Username: <b>' + esc(p.username || 'unknown') + '</b></p>' + profileRoleControl(p) + profileStatusHtml(p) + '<p>Warnings: <b>' + esc(p.warnings || 0) + '</b></p>' + ban + kick + mute + (isStaff() ? '<p>Staff note: ' + esc(p.staff_note || 'None') + '</p>' : '') + profileCommandButtons(p) + '</div>';
    document.body.appendChild(modal); document.getElementById('community-profile-close').onclick = function(){ modal.remove(); };
    wireAvatarPreviews(modal);
    var roleSel = document.getElementById('community-profile-role'); if (roleSel) roleSel.onchange = async function(){ await changeUserRoleV2(p.username, roleSel.value); modal.remove(); };
    Array.prototype.forEach.call(modal.querySelectorAll('.community-profile-command'), function(btn){ btn.onclick = async function(){ var result = await runProfileCommand(p.username, btn.dataset.profileCmd); status(result.message); if (result.ok) { modal.remove(); await loadMembers(state.tab === 'members'); await loadItems(); } }; });
    modal.addEventListener('click', function(e){ if (e.target === modal) modal.remove(); });
  }
  async function runProfileCommand(username, action) {
    if (!username) return { ok: false, message: 'No username on this profile.' };
    if (action === 'deleteuser') { var deleted = await deleteUserByUsername(username); return { ok: !!deleted, message: deleted ? 'Account deleted.' : 'Delete cancelled or failed.' }; }
    var reason = '';
    var minutes = '';
    if (action === 'mute' || action === 'kick') { minutes = prompt(action === 'kick' ? 'Kick length, like 10m, 1h, 1d, or perma' : 'Mute length, like 10m, 1h, 1d, or perma', '10m'); if (minutes == null) return { ok: false, message: 'Command cancelled.' }; }
    if (['warn','mute','kick','ban','unban','unmute'].indexOf(action) !== -1) { reason = prompt('Reason for /' + action + ' ' + username, action === 'unban' || action === 'unmute' ? 'appeal accepted' : 'profile action'); if (reason == null) return { ok: false, message: 'Command cancelled.' }; }
    var command = '/' + action + ' ' + username + (minutes ? ' ' + minutes : '') + (reason ? ' ' + reason : '');
    return runStaffCommandTextV2(command);
  }
  async function deleteUserByUsername(username) {
    if (!isRealSeniorStaff()) { status('A real owner or co-owner account is required to delete accounts.'); return false; }
    var typed = prompt('Type the exact username to delete: ' + username);
    if (typed !== username) { status('Delete cancelled. Username did not match.'); return false; }
    if (firebaseMode) {
      try {
        var target = await firebaseFindUser(username);
        if (!target) { status('Target not found.'); return false; }
        if (target.data.role === 'owner') { status('Owners cannot delete other owners.'); return false; }
        var deletedRef = state.client.db.collection('deletedAccounts').doc(target.id);
        await deletedRef.set({ username: target.data.username || username, deleted_at: new Date().toISOString(), deleted_by: state.user.id });
        try {
          await target.ref.delete();
          var check = await target.ref.get();
          if (check.exists) throw new Error('Firebase did not confirm profile deletion.');
        } catch (deleteError) {
          try { await deletedRef.delete(); } catch (rollbackError) {}
          throw deleteError;
        }
        notifySaved('Account profile deleted');
        await loadMembers(state.tab === 'members');
        await loadItems();
        return true;
      } catch (e) { status(e.message || 'Account deletion failed.'); return false; }
    }
    if (mongoMode) { try { await mongoFetch('/staff/delete-user', { method: 'POST', body: JSON.stringify({ username: username }) }); notifySaved('Account deleted'); await loadMembers(state.tab === 'members'); await loadItems(); return true; } catch (e2) { status(e2.message); return false; } }
    initClient();
    var res = await state.client.rpc('delete_user_by_username', { target_username: username });
    if (res.error) { status(res.error.message); return false; }
    notifySaved('Account deleted');
    await loadMembers(state.tab === 'members');
    await loadItems();
    return true;
  }
  function postById(rows, id) { return rows.filter(function(r){ return String(r.id) === String(id); })[0]; }
  function postEditorMarkup(row, attachment) {
    var note = attachment ? 'File: ' + attachmentName(attachment) : 'No file selected';
    var remove = attachment ? '<button class="community-btn secondary community-post-edit-remove-image" type="button">Remove file</button>' : '';
    return '<div class="community-post-edit-form"><input class="community-post-edit-title" maxlength="120" value="' + esc(stripPostChannel(row.title || '')) + '" aria-label="Post title"><textarea class="community-post-edit-body" maxlength="7000" aria-label="Post text">' + esc(row.body || '') + '</textarea><div class="community-composer-actions"><label class="community-file-label">Replace file<input class="community-post-edit-file" type="file"></label><span class="community-attachment-choice community-post-edit-choice">' + esc(note) + '</span>' + remove + '<button class="community-btn community-post-edit-save" type="button">Save changes</button><button class="community-btn secondary community-post-edit-cancel" type="button">Cancel</button></div></div>';
  }
  function beginPostEdit(row) {
    var card = Array.prototype.filter.call(document.querySelectorAll('.community-post'), function(el){ return String(el.dataset.postId) === String(row.id); })[0];
    if (!card) return;
    var id = String(row.id);
    state.pendingPostEdits[id] = row.attachment || null;
    card.innerHTML = postEditorMarkup(row, state.pendingPostEdits[id]);
    var file = card.querySelector('.community-post-edit-file');
    if (file) file.onchange = async function(e) { try { state.pendingPostEdits[id] = await fileToImageAttachment(e.target.files && e.target.files[0]); card.querySelector('.community-post-edit-choice').textContent = 'Ready: ' + attachmentName(state.pendingPostEdits[id]); } catch(error) { status(error.message || 'File upload failed.'); } };
    var remove = card.querySelector('.community-post-edit-remove-image'); if (remove) remove.onclick = function(){ state.pendingPostEdits[id] = null; card.querySelector('.community-post-edit-choice').textContent = 'No file selected'; remove.remove(); };
    card.querySelector('.community-post-edit-cancel').onclick = function(){ delete state.pendingPostEdits[id]; loadItems(); };
    card.querySelector('.community-post-edit-save').onclick = async function(){
      var title = card.querySelector('.community-post-edit-title').value.trim();
      var body = card.querySelector('.community-post-edit-body').value.trim();
      var attachment = state.pendingPostEdits[id];
      if (!title || (!body && !attachment)) { status('Add a title and either text or a file.'); return; }
      if (hasBadWord(title + ' ' + body)) { status('Blocked word found. This post will not save.'); return; }
      if (rejectRestrictedMention(title + ' ' + body, bodyEl || titleEl)) return;
      try {
        initClient();
        var changes = { title: '[' + state.channelName + '] ' + title, body: body, attachment: attachment || null, updated_at: new Date().toISOString() };
        if (firebaseMode) await state.client.db.collection('posts').doc(id).set(changes, { merge: true });
        else if (mongoMode) await mongoFetch('/posts/' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify(changes) });
        else { if (attachment) throw new Error('Image attachments require the Firebase account database.'); var result = await state.client.from('posts').update({ title: changes.title, body: changes.body, updated_at: changes.updated_at }).eq('id', id); if (result.error) throw result.error; }
        delete state.pendingPostEdits[id]; audit('post-edit', id); notifySaved('Post updated'); loadItems();
      } catch(error) { status(error.message || 'Post edit failed.'); }
    };
  }
  function wirePostActionsV2(rows) {
    Array.prototype.forEach.call(document.querySelectorAll('.community-copy-post'), function(btn){ btn.onclick = function(){ var row = postById(rows, btn.dataset.postId); if (!row) return; navigator.clipboard.writeText(stripPostChannel(row.title || '') + '\n\n' + (row.body || '')).then(function(){ notifySaved('Post copied'); }).catch(function(){ status('Could not copy post.'); }); }; });
    Array.prototype.forEach.call(document.querySelectorAll('.community-edit-post'), function(btn){ btn.onclick = function(){ var row = postById(rows, btn.dataset.postId); if (row && canEditPost(row)) beginPostEdit(row); }; });
    Array.prototype.forEach.call(document.querySelectorAll('.community-delete-post'), function(btn){ btn.onclick = async function(){ var row = postById(rows, btn.dataset.postId); if (!row || !canDeletePost(row) || !confirm('Delete this post?')) return; try { initClient(); if (firebaseMode) await state.client.db.collection('posts').doc(String(row.id)).delete(); else if (mongoMode) await mongoFetch('/posts/' + encodeURIComponent(row.id), { method: 'DELETE' }); else { var result = await state.client.from('posts').delete().eq('id', row.id); if (result.error) throw result.error; } audit('post-delete', row.id); notifySaved('Post deleted'); loadItems(); } catch(error) { status(error.message || 'Post delete failed.'); } }; });
  }
  function wirePostActions(rows) { Array.prototype.forEach.call(document.querySelectorAll('.community-copy-post'), function(btn){ btn.onclick = function(){ var row = postById(rows, btn.dataset.postId); if (!row) return; navigator.clipboard.writeText(stripPostChannel(row.title || '') + '\n\n' + (row.body || '')).then(function(){ notifySaved('Post copied'); }).catch(function(){ status('Could not copy post.'); }); }; }); Array.prototype.forEach.call(document.querySelectorAll('.community-edit-post'), function(btn){ btn.onclick = async function(){ var row = postById(rows, btn.dataset.postId); if (!row || !canEditPost(row)) return; var title = prompt('Post title', stripPostChannel(row.title || '')); if (title == null) return; var body = prompt('Post body', row.body || ''); if (body == null) return; initClient(); if (firebaseMode) { try { await state.client.db.collection('posts').doc(String(row.id)).set({ title: '[' + state.channelName + '] ' + title.trim(), body: body.trim(), updated_at: new Date().toISOString() }, { merge: true }); audit('post-edit', row.id); notifySaved('Post updated'); loadItems(); } catch(e) { status(e.message); } return; } var res = await state.client.from('posts').update({ title: '[' + state.channelName + '] ' + title.trim(), body: body.trim(), updated_at: new Date().toISOString() }).eq('id', row.id); if (res.error) status(res.error.message); else { notifySaved('Post updated'); loadItems(); } }; }); Array.prototype.forEach.call(document.querySelectorAll('.community-delete-post'), function(btn){ btn.onclick = async function(){ var row = postById(rows, btn.dataset.postId); if (!row || !canDeletePost(row)) return; if (!confirm('Delete this post?')) return; initClient(); if (firebaseMode) { try { await state.client.db.collection('posts').doc(String(row.id)).delete(); audit('post-delete', row.id); notifySaved('Post deleted'); loadItems(); } catch(e) { status(e.message); } return; } var res = await state.client.from('posts').delete().eq('id', row.id); if (res.error) status(res.error.message); else { notifySaved('Post deleted'); loadItems(); } }; }); }
  function messageById(rows, id) { return rows.filter(function(r){ return String(r.id) === String(id); })[0]; }
  function wireMessageActions(rows) {
    Array.prototype.forEach.call(document.querySelectorAll('.community-edit-message'), function(btn){ btn.onclick = async function(){ var row = messageById(rows, btn.dataset.messageId); if (!row || !canEditMessage(row)) return; var body = prompt('Edit message', row.body || ''); if (body == null) return; body = body.trim(); if (!body) return; if (hasBadWord(body)) { status('Blocked word found. This edit will not save.'); return; } if (firebaseMode) { try { await state.client.db.collection('messages').doc(String(row.id)).set({ body: body, updated_at: new Date().toISOString() }, { merge: true }); audit('message-edit', row.id); notifySaved('Message edited'); loadItems(); } catch(e) { status(e.message); } return; } if (mongoMode) { try { await mongoFetch('/messages/' + encodeURIComponent(row.id), { method: 'PATCH', body: JSON.stringify({ body: body }) }); audit('message-edit', row.id); notifySaved('Message edited'); loadItems(); } catch(e) { status(e.message); } return; } initClient(); var res = await state.client.from('chat_messages').update({ body: body, updated_at: new Date().toISOString() }).eq('id', row.id); if (res.error) status(res.error.message); else { audit('message-edit', row.id); notifySaved('Message edited'); loadItems(); } }; });
    Array.prototype.forEach.call(document.querySelectorAll('.community-delete-message'), function(btn){ btn.onclick = async function(){ var row = messageById(rows, btn.dataset.messageId); if (!row || !canDeleteMessage(row)) return; if (!confirm('Delete this message? It remains visible in this tab until you refresh or leave.')) return; state.recentlyDeletedMessages[String(row.id)] = true; var auditDetail = String(row.id) + ': ' + String(row.deleted_body || row.body || '').slice(0, 900); if (firebaseMode) { try { await state.client.db.collection('messages').doc(String(row.id)).set({ deleted_at: new Date().toISOString(), deleted_body: row.deleted_body || row.body, body: '[deleted]' }, { merge: true }); audit('message-delete', auditDetail); notifySaved('Message deleted'); loadItems(); } catch(e) { delete state.recentlyDeletedMessages[String(row.id)]; status(e.message); } return; } if (mongoMode) { try { await mongoFetch('/messages/' + encodeURIComponent(row.id), { method: 'DELETE' }); audit('message-delete', auditDetail); notifySaved('Message deleted'); loadItems(); } catch(e) { delete state.recentlyDeletedMessages[String(row.id)]; status(e.message); } return; } initClient(); var res = await state.client.from('chat_messages').update({ deleted_at: new Date().toISOString(), deleted_body: row.deleted_body || row.body, body: '[deleted]' }).eq('id', row.id); if (res.error) { delete state.recentlyDeletedMessages[String(row.id)]; status(res.error.message); } else { audit('message-delete', auditDetail); notifySaved('Message deleted'); loadItems(); } }; });
  }
  function parseDurationToken(v, fallback) { v = String(v || '').toLowerCase(); if (v === 'perm' || v === 'perma' || v === 'forever') return 52560000; var m = v.match(/^(\d+)(m|h|d)?$/); if (!m) return fallback; var n = parseInt(m[1], 10); return m[2] === 'h' ? n * 60 : (m[2] === 'd' ? n * 1440 : n); }
  function parseStaffCommand(text) { var parts = String(text || '').trim().split(/\s+/); var cmd = (parts.shift() || '').replace(/^\//, '').toLowerCase(); if (!cmd) return null; if (cmd === 'role') return { local: 'Current role: ' + role() }; if (cmd === 'setrole') return { action: 'setrole', target: (parts.shift() || '').toLowerCase(), newRole: (parts.shift() || '').toLowerCase(), reason: parts.join(' ') }; if (cmd === 'deleteuser') return { action: 'deleteuser', target: (parts.shift() || '').toLowerCase(), reason: parts.join(' ') }; if (cmd === 'mute' || cmd === 'kick') { var target = (parts.shift() || '').toLowerCase(); var minutes = parseDurationToken(parts[0], cmd === 'kick' ? 10 : 10); if (/^(\d+)(m|h|d)?$|^perm|^perma|^forever/i.test(parts[0] || '')) parts.shift(); return { action: cmd, target: target, minutes: minutes, reason: parts.join(' ') }; } if (['warn','ban','unban','unmute'].indexOf(cmd) !== -1) return { action: cmd, target: (parts.shift() || '').toLowerCase(), minutes: null, reason: parts.join(' ') }; return { error: 'Unknown command.' }; }
  async function runStaffCommandTextV2(text) {
    if (!firebaseMode) return runStaffCommandText(text);
    var parsed = parseStaffCommand(text);
    if (!parsed) return { ok: false, message: 'Type a command first.' };
    if (parsed.local) return { ok: true, message: parsed.local };
    if (parsed.error) return { ok: false, message: parsed.error };
    if (isTempOwner()) return { ok: false, message: 'Temporary owner cannot run live moderation commands.' };
    if (!state.user || !isStaff()) return { ok: false, message: 'Staff account required.' };
    if (!parsed.target) return { ok: false, message: 'Add a target username.' };
    var rr = role();
    if (['ban','unban','setrole','deleteuser'].indexOf(parsed.action) !== -1 && !isRealSeniorStaff()) return { ok: false, message: 'Owner or co-owner role required for /' + parsed.action + '.' };
    if (parsed.action === 'kick' && !(isRealSeniorStaff() || rr === 'admin')) return { ok: false, message: 'Admin, owner, or co-owner required for /kick.' };
    if (['warn','mute','unmute'].indexOf(parsed.action) !== -1 && ['owner','admin','mod'].indexOf(rr) === -1) return { ok: false, message: 'Staff role required.' };
    if (parsed.action === 'deleteuser') return runStaffCommandText(text);
    try {
      var target = await firebaseFindUser(parsed.target);
      if (!target) return { ok: false, message: 'Target not found.' };
      if (target.data.role === 'owner' && target.data.username !== profileUsername()) return { ok: false, message: 'Owners cannot moderate other owners.' };
      var set = {}, now = new Date().toISOString(), autoBanned = false;
      if (parsed.action === 'setrole') {
        if (['owner','admin','mod','member','banned'].indexOf(parsed.newRole) === -1) return { ok: false, message: 'Choose owner, admin, mod, member, or banned.' };
        set.role = parsed.newRole;
        if (parsed.newRole === 'banned') { set.banned_until = '2099-01-01T00:00:00.000Z'; set.banned_at = now; set.ban_id = now + ':' + target.id; }
        else { set.banned_until = null; set.banned_at = null; set.ban_id = null; }
      } else if (parsed.action === 'ban') { set.role = 'banned'; set.banned_until = '2099-01-01T00:00:00.000Z'; set.banned_at = now; set.ban_id = now + ':' + target.id; }
      else if (parsed.action === 'unban') { set.role = 'member'; set.banned_until = null; set.banned_at = null; set.ban_id = null; }
      else if (parsed.action === 'warn') { set.warnings = Number(target.data.warnings || 0) + 1; if (set.warnings >= 3) { set.role = 'banned'; set.banned_until = '2099-01-01T00:00:00.000Z'; set.banned_at = now; set.ban_id = now + ':' + target.id; autoBanned = true; } }
      else if (parsed.action === 'mute') set.muted_until = new Date(Date.now() + (parsed.minutes || 10) * 60000).toISOString();
      else if (parsed.action === 'unmute') set.muted_until = null;
      else if (parsed.action === 'kick') set.kicked_until = new Date(Date.now() + (parsed.minutes || 10) * 60000).toISOString();
      await target.ref.set(set, { merge: true });
      if (parsed.action === 'unban') clearDeviceBan(parsed.target);
      audit('command', '/' + parsed.action + ' ' + parsed.target); notifySaved(autoBanned ? 'Third warning: account was banned.' : 'Command ran'); loadMembers(true); loadItems();
      return { ok: true, message: autoBanned ? 'Third warning issued. Account automatically banned.' : 'Command ran: /' + parsed.action + ' ' + parsed.target };
    } catch (error) { return { ok: false, message: error.message || 'Command failed.' }; }
  }
  async function runStaffCommandText(text) { var parsed = parseStaffCommand(text); if (!parsed) return { ok: false, message: 'Type a command first.' }; if (parsed.local) return { ok: true, message: parsed.local }; if (parsed.error) return { ok: false, message: parsed.error }; if (isTempOwner()) return { ok: false, message: 'Temporary owner can view the terminal, but live commands need a real staff account.' }; if (!state.user || !isStaff()) return { ok: false, message: 'Staff account required.' }; if (!parsed.target) return { ok: false, message: 'Add a target username.' }; var rr = role(); if (['ban','unban','setrole','deleteuser'].indexOf(parsed.action) !== -1 && rr !== 'owner') return { ok: false, message: 'Owner role required for /' + parsed.action + '.' }; if (parsed.action === 'kick' && ['owner','admin'].indexOf(rr) === -1) return { ok: false, message: 'Admin or owner required for /kick.' }; if (['warn','mute','unmute'].indexOf(parsed.action) !== -1 && ['owner','admin','mod'].indexOf(rr) === -1) return { ok: false, message: 'Staff role required.' }; if (firebaseMode) { try { var target = await firebaseFindUser(parsed.target); if (!target) return { ok: false, message: 'Target not found.' }; if (target.data.role === 'owner' && target.data.username !== profileUsername()) return { ok: false, message: 'Owners cannot moderate other owners.' }; var set = {}; if (parsed.action === 'setrole') { if (!parsed.newRole) return { ok: false, message: 'Add a role: owner, admin, mod, member, or banned.' }; set.role = parsed.newRole; set.banned_until = parsed.newRole === 'banned' ? '2099-01-01T00:00:00.000Z' : null; if (parsed.newRole !== 'deleted') set.deleted_at = null; } else if (parsed.action === 'deleteuser') { var deletedRef = state.client.db.collection('deletedAccounts').doc(target.id); await deletedRef.set({ username: target.data.username || parsed.target, deleted_at: new Date().toISOString(), deleted_by: state.user.id }); try { await target.ref.delete(); } catch(deleteError) { try { await deletedRef.delete(); } catch(markerError) {} throw deleteError; } audit('command', '/' + parsed.action + ' ' + parsed.target); notifySaved('Command ran'); loadMembers(true); loadItems(); return { ok: true, message: 'Command ran: /' + parsed.action + ' ' + parsed.target }; } else if (parsed.action === 'ban') { set.role = 'banned'; set.banned_until = '2099-01-01T00:00:00.000Z'; set.deleted_at = null; } else if (parsed.action === 'unban') { set.role = 'member'; set.banned_until = null; set.deleted_at = null; } else if (parsed.action === 'warn') { set.warnings = (Number(target.data.warnings || 0) + 1); } else if (parsed.action === 'mute') { set.muted_until = new Date(Date.now() + (parsed.minutes || 10) * 60000).toISOString(); } else if (parsed.action === 'unmute') { set.muted_until = null; } else if (parsed.action === 'kick') { set.kicked_until = new Date(Date.now() + (parsed.minutes || 10) * 60000).toISOString(); } await target.ref.set(set, { merge: true }); if (parsed.action === 'unban') clearDeviceBan(parsed.target); audit('command', '/' + parsed.action + ' ' + parsed.target); notifySaved('Command ran'); loadMembers(true); loadItems(); return { ok: true, message: 'Command ran: /' + parsed.action + ' ' + parsed.target }; } catch(e) { return { ok: false, message: e.message }; } } if (mongoMode) { try { if (parsed.action === 'setrole') { if (!parsed.newRole) return { ok: false, message: 'Add a role: owner, admin, mod, member, or banned.' }; await mongoFetch('/staff/role', { method: 'POST', body: JSON.stringify({ username: parsed.target, role: parsed.newRole }) }); } else if (parsed.action === 'deleteuser') { await mongoFetch('/staff/delete-user', { method: 'POST', body: JSON.stringify({ username: parsed.target }) }); } else { await mongoFetch('/staff/moderate', { method: 'POST', body: JSON.stringify({ username: parsed.target, action: parsed.action, reason: parsed.reason || '', minutes: parsed.minutes || null }) }); } if (parsed.action === 'unban') { try { localStorage.removeItem('uzBannedAccount:' + String(parsed.target || '').toLowerCase()); } catch(e) {} } audit('command', '/' + parsed.action + ' ' + parsed.target); notifySaved('Command ran'); loadMembers(true); loadItems(); return { ok: true, message: 'Command ran: /' + parsed.action + ' ' + parsed.target }; } catch(e) { return { ok: false, message: e.message }; } } initClient(); var res; if (parsed.action === 'setrole') { if (!parsed.newRole) return { ok: false, message: 'Add a role: owner, admin, mod, member, or banned.' }; res = await state.client.rpc('set_user_role', { target_username: parsed.target, new_role: parsed.newRole }); } else if (parsed.action === 'deleteuser') { res = await state.client.rpc('delete_user_by_username', { target_username: parsed.target }); } else { res = await state.client.rpc('moderate_user', { target_username: parsed.target, action_name: parsed.action, reason_text: parsed.reason || '', duration_minutes: parsed.minutes || null }); } if (res.error) return { ok: false, message: res.error.message }; if (parsed.action === 'unban') { try { localStorage.removeItem('uzBannedAccount:' + String(parsed.target || '').toLowerCase()); } catch(e) {} } audit('command', '/' + parsed.action + ' ' + parsed.target); notifySaved('Command ran'); loadMembers(true); loadItems(); return { ok: true, message: 'Command ran: /' + parsed.action + ' ' + parsed.target }; }
  function warnBlockedInput(el, msg) { status(msg || 'Blocked word found. This will not send.'); if (el) { el.classList.remove('community-input-warn'); void el.offsetWidth; el.classList.add('community-input-warn'); el.focus(); } }
  async function sendMessage() { if (!state.user) { status('Sign in first.'); return; } var input = $('community-chat-input'); if (!input) { status('Chat box is not ready.'); return; } var body = input.value.trim(); if (!body) return; if (hasBadWord(body)) { warnBlockedInput(input, 'Blocked word found. This message will not send.'); return; } if (firebaseMode) { try { await state.client.db.collection('messages').add({ user_id: state.user.id, username: profileUsername(), body: body, created_at: new Date().toISOString() }); input.value = ''; audit('message', body.slice(0,80)); notifySaved('Message sent'); loadItems(); } catch(e) { status(e.message); } return; } if (mongoMode) { try { await mongoFetch('/messages', { method: 'POST', body: JSON.stringify({ body: body }) }); input.value = ''; audit('message', body.slice(0,80)); notifySaved('Message sent'); loadItems(); } catch(e) { status(e.message); } return; } initClient(); var res = await state.client.from('chat_messages').insert({ user_id: state.user.id, body: body }); if (res.error) { status(res.error.message); return; } input.value = ''; audit('message', body.slice(0,80)); notifySaved('Message sent'); loadItems(); }
  async function sendMessageV2() {
    if (!firebaseMode || !(state.pendingChatAttachments || []).length) { var plainInput = $('community-chat-input'); if (plainInput && rejectRestrictedMention(plainInput.value, plainInput)) return; return sendMessage(); }
    if (!state.user) { status('Sign in first.'); return; }
    var input = $('community-chat-input'); var body = String((input && input.value) || '').trim();
    var attachments = state.pendingChatAttachments || [];
    if (!body && !attachments.length) return;
    if (hasBadWord(body)) { warnBlockedInput(input, 'Blocked word found. This message will not send.'); return; }
    if (rejectRestrictedMention(body, input)) return;
    try {
      initClient();
      await createFirebaseItemWithAttachments('messages', { user_id: state.user.id, username: profileUsername(), body: body, created_at: new Date().toISOString() }, attachments);
      notifyMentionedUsers(body, { tab: 'chat' }); state.pendingChatAttachments = []; if (input) input.value = ''; showAttachmentQueue('community-chat-file-choice', []); audit('message', body.slice(0,80)); notifySaved('Message sent'); loadItems();
    } catch (error) { status(error.message || 'Message could not be sent.'); }
  }
  async function sendPostMessage() {
    if (!canPost()) { status('You cannot post in this channel.'); return; }
    if (!state.user) { status('Sign into a real account before publishing.'); return; }
    var titleEl = $('community-post-title'); var bodyEl = $('community-post-body');
    var title = titleEl ? titleEl.value.trim() : ''; var body = bodyEl ? bodyEl.value.trim() : '';
    var attachment = state.pendingPostAttachment;
    if (!title || (!body && !attachment)) { status('Add a title and either text or an image.'); return; }
    if (hasBadWord(title + ' ' + body)) { warnBlockedInput(bodyEl || titleEl, 'Blocked word found. This post will not publish.'); return; }
    try {
      initClient();
      var record = { title: '[' + state.channelName + '] ' + title, body: body, attachment: attachment || null };
      if (firebaseMode) {
        record.user_id = state.user.id; record.username = profileUsername(); record.created_at = new Date().toISOString();
        await state.client.db.collection('posts').add(record);
      } else if (mongoMode) {
        await mongoFetch('/posts', { method: 'POST', body: JSON.stringify(record) });
      } else {
        if (attachment) throw new Error('Image attachments require the Firebase account database.');
        var res = await state.client.from('posts').insert({ user_id: state.user.id, title: record.title, body: record.body });
        if (res.error) throw res.error;
      }
      state.pendingPostAttachment = null;
      if (titleEl) titleEl.value = ''; if (bodyEl) bodyEl.value = ''; showAttachmentChoice('community-file-choice', null);
      audit('post', title); notifySaved('Posted'); loadItems();
    } catch (error) { status(error.message || 'Post could not be published.'); }
  }
  function subscribe() {
    if (!ready || !state.client || !firebaseAvailable()) return;
    if (typeof state.realtime === 'function') state.realtime(); else if (state.realtime && state.client.removeChannel) state.client.removeChannel(state.realtime);
    state.realtime = null;
    if (state.tab === 'voice') return;
    if (firebaseMode) {
      var collection = state.tab === 'members' ? 'profiles' : (state.tab === 'chat' ? 'messages' : 'posts');
      var query = collection === 'profiles' ? state.client.db.collection(collection).limit(200) : state.client.db.collection(collection).orderBy('created_at', 'desc').limit(60);
      state.realtime = query.onSnapshot(function(){ loadItems(); }, function(error){ firebaseCooldown(error); });
      return;
    }
    if (state.tab === 'members') return;
    var table = state.tab === 'chat' ? 'chat_messages' : 'posts'; state.realtime = state.client.channel('uz-' + table).on('postgres_changes', { event: '*', schema: 'public', table: table }, loadItems).subscribe();
  }
  document.addEventListener('uz-notification-open', function(event){
    var item = event.detail || {}; var target = item.target || {};
    if (target.tab) setTab(target.tab, target.channel || (target.tab === 'chat' ? 'chat' : state.channelName));
    setTimeout(function(){ var selector = target.id ? '[data-message-id="' + String(target.id).replace(/"/g, '') + '"],[data-post-id="' + String(target.id).replace(/"/g, '') + '"],[data-announcement-id="' + String(target.id).replace(/"/g, '') + '"]' : ''; var found = selector ? document.querySelector(selector) : null; if (found) { found.scrollIntoView({ behavior: 'smooth', block: 'center' }); found.classList.add('community-notification-focus'); setTimeout(function(){ found.classList.remove('community-notification-focus'); }, 1800); } }, 220);
  });
  window.UZCommunity = { saveProfile: saveProfile, updateProfile: updateProfileDetails, loadStaffLogs: loadStaffLogs, logout: logout, refresh: refreshSession, role: role, isStaff: isStaff, runCommand: runStaffCommandTextV2, renderAnnouncements: renderAnnouncementsPanel, openTerminal: function(){ if (window.openUZCommandPalette) window.openUZCommandPalette(); } };
  window.UZ_ACCOUNT_DEBUG.push('community-js-ready');
  window.initCommunity = function () { ensureCommunityTools(); Array.prototype.forEach.call(document.querySelectorAll('.community-tab'), function(btn){ btn.onclick = function(){ setTab(btn.dataset.communityTab, btn.dataset.communityChannel); }; }); renderChannelHeader(); refreshSession(); setTab('chat', 'chat'); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', window.initCommunity); else window.initCommunity();
}());
