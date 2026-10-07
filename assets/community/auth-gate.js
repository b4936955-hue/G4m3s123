(function () {
  window.UZ_ACCOUNT_DEBUG = window.UZ_ACCOUNT_DEBUG || [];
  window.UZ_ACCOUNT_DEBUG.push('auth-gate-start');
  var cfg = window.UZ_COMMUNITY_CONFIG || {};
  var client = null;
  var mongoApiUrl = String(cfg.mongoApiUrl || '').replace(/\/$/, '');
  var mongoMode = !!mongoApiUrl;
  var firebaseMode = !mongoMode && cfg.authProvider === 'firebase';
  var firebaseReady = firebaseMode && cfg.firebaseConfig && cfg.firebaseConfig.apiKey && cfg.firebaseConfig.projectId && window.firebase;
  var ready = mongoMode || firebaseReady || Boolean(cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase);
  var konami = ['ArrowUp','ArrowUp','ArrowDown','ArrowDown','ArrowLeft','ArrowRight','ArrowLeft','ArrowRight','b','a'];
  var konamiIndex = 0;
  var authMode = 'signin';
  var authTransition = false;
  var tempOwnerActive = false; window.UZTempOwnerActive = false; window.UZCurrentProfile = null;
  function debugLog(label, detail) {
    try {
      window.UZ_ACCOUNT_DEBUG.push(new Date().toISOString() + ' ' + label + (detail ? ': ' + detail : ''));
      if (window.UZ_ACCOUNT_DEBUG.length > 80) window.UZ_ACCOUNT_DEBUG.splice(0, window.UZ_ACCOUNT_DEBUG.length - 80);
    } catch(e) {}
  }
  function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function cleanUsername(v) { return String(v || '').toLowerCase().replace(/[^a-z0-9_.-]/g, '').slice(0, 24); }
  function authEmail(username) { return cleanUsername(username) + '@' + (cfg.internalAuthDomain || 'uzlogin.net'); }
  function profileStorageUser() { return cleanUsername(localStorage.getItem('uzLoginEmail') || 'guest') || 'guest'; }
  function profileKey(name, username) { return name + ':' + cleanUsername(username || profileStorageUser()); }
  function getName(username) { return String(localStorage.getItem(profileKey('uzCommunityProfileName', username)) || '').trim(); }
  function getAvatar(username) { return String(localStorage.getItem(profileKey('uzCommunityAvatar', username)) || '').trim(); }
  function profileImageDataUrl(file) {
    if (!file || !/^image\//i.test(file.type || '')) return Promise.reject(new Error('Choose an image file.'));
    if (file.size > 8 * 1024 * 1024) return Promise.reject(new Error('That image is too large. Choose one below 8 MB.'));
    return new Promise(function(resolve, reject) {
      var reader = new FileReader();
      reader.onerror = function(){ reject(new Error('The image could not be read.')); };
      reader.onload = function(){
        var source = String(reader.result || '');
        var image = new Image();
        image.onerror = function(){ reject(new Error('The image could not be prepared.')); };
        image.onload = function(){
          var edge = Math.min(512, Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height));
          var attempt = 0;
          function encode() {
            var scale = Math.min(1, edge / Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height));
            var width = Math.max(1, Math.round((image.naturalWidth || image.width) * scale));
            var height = Math.max(1, Math.round((image.naturalHeight || image.height) * scale));
            var canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
            canvas.getContext('2d').drawImage(image, 0, 0, width, height);
            var data = canvas.toDataURL('image/jpeg', Math.max(.58, .88 - attempt * .08));
            if (data.length <= 250000) { resolve(data); return; }
            attempt++; edge = Math.round(edge * .72);
            if (attempt > 4 || edge < 96) { reject(new Error('That image is still too large after resizing.')); return; }
            encode();
          }
          encode();
        };
        image.src = source;
      };
      reader.readAsDataURL(file);
    });
  }
  function usernameFromUser(user) { return (user && user.user_metadata && user.user_metadata.username) || (user && user.email ? user.email.split('@')[0] : ''); }
  var ACCOUNT_SETTING_KEYS = [
    'siteTheme', 'loadingTheme', 'accentColorV2', 'bgMode', 'customWallpaper', 'gradientC1', 'gradientC2', 'gradientAngle',
    'sidebarPosition', 'uzSidebarHidden', 'activeCursor', 'customCursor', 'customVideoCursor', 'musicOnStartup', 'startupLoadingScreen', 'startupBlockScreen',
    'g4mesVolume', 'g4mesTabMode', 'favoriteg4mes', 'crosshairEnabled', 'crosshairStyle', 'crosshairSize', 'crosshairColor',
    'crosshairCustomRaw', 'panicEnabled', 'panicKey', 'panicUrl', 'panicAction', 'stealthCover', 'stretchedRes', 'perfMode',
    'cloakPreset', 'cloakCustomTitle', 'cloakCustomFavicon', 'openGamesInBlob', 'uzVoiceMuted', 'uzVoiceDeafened',
    'accentColor', 'cdnMirror', 'adLayout', 'lightspeedSchoolName', 'lightspeedTopText', 'lightspeedBottomText',
    'lightspeedSystemMsg', 'scUrl', 'scHeading', 'scIp',
    'ggTitle', 'ggMessage', 'scMessage', 'scReason', 'scPolicy', 'lqGlassButtons',
    'homeMusicTracks', 'homeMusicVolume', 'homeMusicIndex', 'uzVoiceJoined',
    'cloakTitle', 'cloakFavicon', 'hiddenPageCover', 'sidebarIconsOnly', 'uzRequireLogin',
    'uzNotifications', 'uzAuditLog'
  ];
  function accountSettingKey(username, key) { return 'uzacct:settings:' + cleanUsername(username) + ':' + key; }
  window.UZExportAccountSettings = function () {
    var values = {};
    ACCOUNT_SETTING_KEYS.forEach(function (key) {
      var value = localStorage.getItem(key);
      if (value !== null) values[key] = value;
    });
    return values;
  };
  window.UZSettingsBackupAccounts = function (values) {
    var names = [];
    Object.keys(values).forEach(function (key) {
      var match = key.match(/^uzacct:(?:settings:)?([^:]+):/);
      if (match && match[1] !== 'theme' && names.indexOf(match[1]) === -1) names.push(match[1]);
    });
    return names;
  };
  window.UZImportAccountSettings = function (values, sourceAccount) {
    var normalized = {};
    var ranks = {};
    var current = cleanUsername(sourceAccount || localStorage.getItem('uzLoginEmail') || '');
    Object.keys(values).forEach(function (original) {
      var key = original.replace(/^uzacct:settings:[^:]+:/, '').replace(/^uzacct:[^:]+:/, '');
      var account = original.match(/^uzacct:(?:settings:)?([^:]+):/);
      if (sourceAccount && account && account[1] !== current) return;
      var rank = original === key ? 4 : account && account[1] === current ? (original.indexOf('uzacct:settings:') === 0 ? 2 : 3) : 1;
      if (ACCOUNT_SETTING_KEYS.indexOf(key) !== -1 && values[original] != null && (ranks[key] == null || rank > ranks[key])) {
        normalized[key] = String(values[original]);
        ranks[key] = rank;
      }
    });
    window.__uzUserSettingsChange = true;
    try {
      Object.keys(normalized).forEach(function (key) {
        localStorage.setItem(key, normalized[key]);
        if (window.UZSaveThemeSetting) window.UZSaveThemeSetting(key, normalized[key]);
        window.UZPersistAccountSetting(key, normalized[key]);
      });
    } finally { window.__uzUserSettingsChange = false; }
    window.__uzRestoringAccountSettings = true;
    try {
      if (typeof window.rehydrateSettings === 'function') window.rehydrateSettings();
    } finally { window.__uzRestoringAccountSettings = false; }
    if (typeof window.UZFlushAccountSettings === 'function') window.UZFlushAccountSettings(current, normalized);
    return Object.keys(normalized).length;
  };
  var cloudSettingsWrite = { timer: null, uid: '', username: '', values: {} };
  function queueFirebaseSetting(username, key, value) {
    if (!firebaseMode || !client || !client.auth || !client.db || window.__uzRestoringAccountSettings) return;
    var user = client.auth.currentUser;
    username = cleanUsername(username);
    if (!user || !username || cleanUsername(usernameFromUser(user)) !== username) return;
    if (cloudSettingsWrite.uid !== user.uid || cloudSettingsWrite.username !== username) {
      clearTimeout(cloudSettingsWrite.timer);
      cloudSettingsWrite = { timer: null, uid: user.uid, username: username, values: {} };
    }
    cloudSettingsWrite.values[key] = value === null ? null : String(value);
    clearTimeout(cloudSettingsWrite.timer);
    var flushDelay = /^(accentColorV2|bgMode|siteTheme)$/.test(key) ? 0 : 250;
    cloudSettingsWrite.timer = setTimeout(function () {
      var pending = cloudSettingsWrite;
      cloudSettingsWrite = { timer: null, uid: '', username: '', values: {} };
      var current = client && client.auth && client.auth.currentUser;
      if (!current || current.uid !== pending.uid || !Object.keys(pending.values).length) return;
      client.db.collection('profiles').doc(pending.uid).set({
        settings: pending.values,
        settings_updated_at: new Date().toISOString()
      }, { merge: true }).then(function () {
        if (window.UZCurrentProfile && cleanUsername(window.UZCurrentProfile.username) === pending.username) {
          window.UZCurrentProfile.settings = Object.assign({}, window.UZCurrentProfile.settings || {}, pending.values);
        }
      }).catch(function (e) { debugLog('settings-save-failed', e && e.message ? e.message : 'unknown'); });
    }, flushDelay);
  }
  window.UZPersistAccountSetting = function (key, value) {
    key = String(key || '');
    if (ACCOUNT_SETTING_KEYS.indexOf(key) === -1) return;
    var username = cleanUsername(localStorage.getItem('uzLoginEmail') || '');
    if (!username) return;
    try {
      if (value === null) localStorage.removeItem(accountSettingKey(username, key));
      else localStorage.setItem(accountSettingKey(username, key), String(value));
    } catch (e) {}
    queueFirebaseSetting(username, key, value);
  };
  window.UZFlushAccountSettings = function (username, values) {
    username = cleanUsername(username || localStorage.getItem('uzLoginEmail') || '');
    if (!firebaseMode || !client || !client.auth || !client.db || !username) return;
    var user = client.auth.currentUser;
    if (!user || cleanUsername(usernameFromUser(user)) !== username) return;
    var payload = {};
    Object.keys(values || {}).forEach(function (key) {
      if (ACCOUNT_SETTING_KEYS.indexOf(key) !== -1 && values[key] != null) payload[key] = String(values[key]);
    });
    if (!Object.keys(payload).length) return;
    client.db.collection('profiles').doc(user.uid).set({
      settings: payload,
      settings_updated_at: new Date().toISOString()
    }, { merge: true }).then(function () {
      if (window.UZCurrentProfile && cleanUsername(window.UZCurrentProfile.username) === username) {
        window.UZCurrentProfile.settings = Object.assign({}, window.UZCurrentProfile.settings || {}, payload);
      }
    }).catch(function (e) { debugLog('settings-flush-failed', e && e.message ? e.message : 'unknown'); });
  };
  function saveAccountSettings(username) {
    username = cleanUsername(username);
    if (!username) return;
    ACCOUNT_SETTING_KEYS.forEach(function (key) {
      try {
        var value = localStorage.getItem(key);
        if (value !== null) localStorage.setItem(accountSettingKey(username, key), value);
      } catch (e) {}
    });
  }
  function restoreAccountSettings(username, cloudSettings, repeated) {
    username = cleanUsername(username);
    if (!username) return;
    window.__uzRestoringAccountSettings = true;
    var savedTheme = typeof window.UZReadThemeSettings === 'function' ? window.UZReadThemeSettings(username) : null;
    ['accentColorV2', 'bgMode', 'siteTheme'].forEach(function (key) {
      if (savedTheme && savedTheme[key] != null) localStorage.setItem(accountSettingKey(username, key), String(savedTheme[key]));
    });
    if (cloudSettings && typeof cloudSettings === 'object') {
      ACCOUNT_SETTING_KEYS.forEach(function (key) {
        try {
          if (Object.prototype.hasOwnProperty.call(cloudSettings, key) && cloudSettings[key] === null) {
            localStorage.removeItem(accountSettingKey(username, key));
            localStorage.removeItem(key);
          } else if (cloudSettings[key] != null && !(savedTheme && savedTheme[key] != null)) localStorage.setItem(accountSettingKey(username, key), String(cloudSettings[key]));
        } catch (e) {}
      });
    }
    ACCOUNT_SETTING_KEYS.forEach(function (key) {
      try {
        var value = localStorage.getItem(accountSettingKey(username, key));
        if (value === null) {
          value = localStorage.getItem(key);
          if (value !== null) localStorage.setItem(accountSettingKey(username, key), value);
        } else localStorage.setItem(key, value);
      } catch (e) {}
    });
    window.__uzSettingsReady = true;
    try {
      var savedSiteTheme = localStorage.getItem('siteTheme');
      if (savedSiteTheme && typeof window.setSiteTheme === 'function') window.setSiteTheme(savedSiteTheme);
      if (typeof window.setAccent === 'function') window.setAccent(localStorage.getItem('accentColorV2') || '#ff6600');
      if (typeof window.setBackground === 'function') window.setBackground(localStorage.getItem('bgMode') || 'starfield', true);
      if (typeof window.rehydrateSettings === 'function') window.rehydrateSettings();
      else if (typeof window.loadLightspeedText === 'function') window.loadLightspeedText();
    } catch (e) { debugLog('settings-render-failed', e.message || 'unknown'); }
    window.__uzRestoringAccountSettings = false;
    if (!repeated) {
      [120, 500, 1200].forEach(function (delay) {
        setTimeout(function () {
          if (cleanUsername(localStorage.getItem('uzLoginEmail') || '') !== username) return;
          restoreAccountSettings(username, null, true);
        }, delay);
      });
    }
  }
  // Appearance controls commit the user's choice independently of renderer setup.
  function captureAppearanceChoice(event) {
    var target = event.target;
    if (!target || !target.closest) return;
    var control = target.closest('button, select');
    if (!control) return;
    var key = '', value = '';
    if (event.type === 'change' && /^(bg-select|setup-bg-select)$/.test(control.id)) { key = 'bgMode'; value = control.value; }
    else if (event.type === 'change' && control.id === 'theme-select') { key = 'siteTheme'; value = control.value; }
    else if (event.type === 'click') {
      var action = control.getAttribute('onclick') || '';
      var color = action.match(/setAccent\('([^']+)'\)/);
      if (color) { key = 'accentColorV2'; value = color[1]; }
      else if (action.indexOf('setAccent(') !== -1) {
        key = 'accentColorV2';
        var input = document.getElementById('custom-color-input');
        var picker = document.getElementById('custom-color-picker');
        value = (input && input.value) || (picker && picker.value) || '';
      }
    }
    if (!key || !value) return;
    window.__uzUserSettingsChange = true;
    try {
      localStorage.setItem(key, value);
      if (window.UZSaveThemeSetting) window.UZSaveThemeSetting(key, value);
      window.UZPersistAccountSetting(key, value);
      debugLog('settings-user-choice', key + '=' + value);
    } finally { window.__uzUserSettingsChange = false; }
  }
  document.addEventListener('click', captureAppearanceChoice, true);
  document.addEventListener('change', captureAppearanceChoice, true);
  function clearActiveSettings() {
    window.__uzSettingsReady = false;
    ACCOUNT_SETTING_KEYS.forEach(function (key) { try { localStorage.removeItem(key); } catch (e) {} });
    ['lightspeedSchoolName', 'lightspeedTopText', 'lightspeedBottomText', 'lightspeedSystemMsg', 'scUrl', 'scHeading', 'scIp'].forEach(function (key) { try { localStorage.removeItem(key); } catch (e) {} });
    try {
      document.documentElement.classList.remove('midnight-theme', 'g4mes-open', 'perf-mode');
      document.body.classList.remove('uz-sidebar-hidden', 'uz-app-unlocked', 'uz-flash-good', 'uz-flash-bad');
      document.body.classList.add('uz-auth-locked');
      if (typeof window.closeg4mesViewer === 'function') window.closeg4mesViewer();
      document.querySelectorAll('.uz-gust-overlay, #uz-profile-modal, #uz-owner-code-modal, #uz-command-palette, #uz-audit-panel').forEach(function (el) { el.remove(); });
      if (typeof window.switchTab === 'function') window.switchTab('home');
      else {
        document.querySelectorAll('.tab-content').forEach(function (el) { el.classList.toggle('active', el.id === 'home'); });
        document.querySelectorAll('.sidebar-btn').forEach(function (el) { el.classList.toggle('active', el.dataset.tab === 'home'); });
      }
    } catch (e) {}
  }
  function prepareAccountSettings(username, cloudSettings) {
    username = cleanUsername(username);
    if (!username) return;
    var pendingProfile = window.UZPendingProfileSettings;
    if (!cloudSettings && pendingProfile && cleanUsername(pendingProfile.username) === username) cloudSettings = pendingProfile.settings;
    var current = cleanUsername(localStorage.getItem('uzLoginEmail') || '');
    if (current && current !== username) saveAccountSettings(current);
    try { localStorage.setItem('uzLoginEmail', username); } catch (e) {}
    restoreAccountSettings(username, cloudSettings);
  }
  async function setFirebasePersistence() {
    if (!firebaseMode || !client || !client.auth || !client.auth.setPersistence || !window.firebase || !window.firebase.auth || !window.firebase.auth.Auth) return;
    var persistence = rememberWanted() ? window.firebase.auth.Auth.Persistence.LOCAL : window.firebase.auth.Auth.Persistence.SESSION;
    await client.auth.setPersistence(persistence);
  }
  function setLightspeed(name) {
    try {
      localStorage.setItem('uzLoginEmail', name || '');
      var defaults = {
        lightspeedSchoolName: 'Central Bucks School District',
        lightspeedTopText: 'Oops,',
        lightspeedBottomText: 'is not available because it is categorized as Security - Proxy.',
        lightspeedSystemMsg: 'You are logged in as ' + (name || 'user') + ' (IP Address: hidden).',
        scUrl: 'Unblocked Zone',
        scHeading: 'Unblocked Zone',
        scIp: 'hidden'
      };
      Object.keys(defaults).forEach(function (key) {
        var current = localStorage.getItem(key);
        if (current === null || (key === 'lightspeedSchoolName' && current === 'Unblocked Zone') || (key === 'lightspeedSystemMsg' && /^You are logged in as\s+/i.test(current))) localStorage.setItem(key, defaults[key]);
      });
    } catch (e) {}
  }
  function isTempOwner() { return tempOwnerActive === true || window.UZTempOwnerActive === true; }
  function bypassCodeReady() { return typeof cfg.ownerBypassHash === 'string' && /^[a-f0-9]{64}$/i.test(cfg.ownerBypassHash); }
  async function sha256Hex(value) { var data = new TextEncoder().encode(value); var digest = await crypto.subtle.digest('SHA-256', data); return Array.from(new Uint8Array(digest)).map(function(b){ return b.toString(16).padStart(2, '0'); }).join(''); }
  function authUrl() { return String(cfg.supabaseUrl || '').replace(/\/rest\/v1\/?$/, '').replace(/\/$/, ''); }
  function initClient() { if (firebaseMode && firebaseReady && !client) { if (!window.firebase.apps.length) window.firebase.initializeApp(cfg.firebaseConfig); client = { auth: window.firebase.auth(), db: window.firebase.firestore() }; return; } if (!mongoMode && ready && !client) client = window.supabase.createClient(authUrl(), cfg.supabaseAnonKey); }
  function mongoToken() { return localStorage.getItem('uzMongoToken') || sessionStorage.getItem('uzMongoToken') || ''; }
  var wakeStarted = false;
  function setBusy(text) {
    var btn = document.getElementById('uz-login-primary');
    if (!btn) return;
    if (!btn.dataset.originalText) btn.dataset.originalText = btn.textContent || 'Continue';
    btn.disabled = !!text;
    btn.textContent = text || btn.dataset.originalText;
    btn.classList.toggle('is-loading', !!text);
  }
  async function mongoFetch(path, options) {
    options = options || {};
    options.headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
    var token = mongoToken();
    if (token) options.headers.Authorization = 'Bearer ' + token;
    var controller = window.AbortController ? new AbortController() : null;
    var timeout = setTimeout(function(){ if (controller) controller.abort(); }, Number(options.timeout || 20000));
    if (controller) options.signal = controller.signal;
    delete options.timeout;
    var res;
    try {
      res = await fetch(mongoApiUrl + path, options);
    } catch (e) {
      debugLog('api-fetch-failed', path + ' ' + (e && e.name ? e.name : 'fetch'));
      var offline = new Error('Mongo account API is not reachable at ' + mongoApiUrl + '. If this host is blocked, switch the API URL to a different deployed host.');
      offline.cause = e;
      offline.offline = true;
      throw offline;
    } finally {
      clearTimeout(timeout);
    }
    var data = await res.json().catch(function(){ return {}; });
    if (!res.ok) {
      var err = new Error(data.error || 'Mongo API request failed.');
      err.status = res.status; err.data = data;
      throw err;
    }
    return data;
  }
  function wakeAccountApi() {
    if (!mongoMode || wakeStarted) return;
    wakeStarted = true;
    mongoFetch('/health', { timeout: 45000 }).then(function(){
      debugLog('api-awake', mongoApiUrl);
    }).catch(function(e){
      debugLog('api-wake-failed', e && e.message ? e.message : 'unknown');
    });
  }
  function mongoProfileToSession(user) { return user ? { user: { id: user.id, email: user.username + '@' + (cfg.internalAuthDomain || 'uzlogin.net'), user_metadata: { username: user.username } } } : null; }
  function firebaseProfileToSession(user, profile) { return user ? { user: { id: user.uid, email: user.email, user_metadata: { username: (profile && profile.username) || usernameFromUser(user) } } } : null; }
  function note(msg, html) { var el = document.getElementById('uz-auth-error'); if (!el) return; if (html) el.innerHTML = msg || ''; else el.textContent = msg || ''; }
  function rememberWanted() { var box = document.getElementById('uz-remember-me'); return !box || box.checked; }
  function recentAccounts() { try { return JSON.parse(localStorage.getItem('uzRecentAccounts') || '[]').filter(function(a){ return a && a.username && Date.now() - a.time < 2592000000; }).slice(0, 12); } catch(e) { return []; } }
  function removeRecentAccount(username) { var u = cleanUsername(username); localStorage.setItem('uzRecentAccounts', JSON.stringify(recentAccounts().filter(function(a){ return cleanUsername(a.username) !== u; }))); }
  function clearAccountLocalState(username) {
    username = cleanUsername(username);
    if (!username) return;
    try {
      localStorage.removeItem(profileKey('uzCommunityProfileName', username));
      localStorage.removeItem(profileKey('uzCommunityAvatar', username));
      ACCOUNT_SETTING_KEYS.forEach(function (key) { localStorage.removeItem(accountSettingKey(username, key)); });
      var prefixes = ['uzacct:settings:' + username + ':', 'uzCommunityProfileName:' + username, 'uzCommunityAvatar:' + username];
      for (var i = localStorage.length - 1; i >= 0; i--) {
        var key = localStorage.key(i) || '';
        if (prefixes.some(function (prefix) { return key.indexOf(prefix) === 0; })) localStorage.removeItem(key);
      }
      localStorage.removeItem('uzBannedAccount:' + username);
      sessionStorage.removeItem('uzAccountRefresh:' + username);
    } catch (e) {}
    removeRecentAccount(username);
  }
  function siteBannedName() { return cleanUsername(localStorage.getItem('uzSiteBanned') || ''); }
  function recentDaysLeft(a) { return Math.max(1, Math.ceil((2592000000 - (Date.now() - a.time)) / 86400000)); }
  function saveRecentAccount(username) { if (!rememberWanted()) { localStorage.setItem('uzRememberMe', 'false'); return; } var list = recentAccounts().filter(function(a){ return a.username !== username; }); list.unshift({ username: username, time: Date.now() }); localStorage.setItem('uzRecentAccounts', JSON.stringify(list.slice(0, 6))); localStorage.setItem('uzRememberMe', 'true'); }
  function recentAccountsHtml() {
    var list = recentAccounts();
    if (!list.length || authMode !== 'signin') return '';
    var first = list.slice(0, 5).map(function(a){ var banned = localStorage.getItem('uzBannedAccount:' + cleanUsername(a.username)) === '1'; return '<button type="button" class="uz-recent-account' + (banned ? ' is-banned' : '') + '" data-username="' + esc(a.username) + '">' + esc(a.username) + ' <small>' + (banned ? 'banned' : recentDaysLeft(a) + 'd') + '</small><b data-remove-recent="1">x</b></button>'; }).join('');
    var rest = list.slice(5).map(function(a){ var banned = localStorage.getItem('uzBannedAccount:' + cleanUsername(a.username)) === '1'; return '<button type="button" class="uz-recent-account' + (banned ? ' is-banned' : '') + '" data-username="' + esc(a.username) + '">' + esc(a.username) + ' <small>' + (banned ? 'banned' : recentDaysLeft(a) + 'd') + '</small><b data-remove-recent="1">x</b></button>'; }).join('');
    return '<div class="uz-recent-accounts"><span>Recent accounts</span>' + first + (rest ? '<details class="uz-recent-more"><summary>More</summary>' + rest + '</details>' : '') + '</div>';
  }
  function wireRecentAccounts() { Array.prototype.forEach.call(document.querySelectorAll('.uz-recent-account'), function(btn){ btn.onclick = function(e){ if (e.target && e.target.dataset && e.target.dataset.removeRecent) { removeRecentAccount(btn.dataset.username || ''); renderGate('Recent account removed.'); return; } var username = btn.dataset.username || ''; var input = document.getElementById('uz-login-user'); if (input) input.value = username; var pass = document.getElementById('uz-login-pass'); if (pass) pass.focus(); }; }); }
  function switchAccountsHtml(currentUsername) { var list = recentAccounts().filter(function(a){ return cleanUsername(a.username) !== cleanUsername(currentUsername); }); if (!list.length) return '<button class="community-btn secondary" id="uz-switch-account" type="button">Switch account</button>'; return '<details class="uz-switch-accounts"><summary>Switch account</summary>' + list.map(function(a){ return '<button type="button" class="uz-switch-account-option" data-username="' + esc(a.username) + '">' + esc(a.username) + ' <small>' + recentDaysLeft(a) + 'd left</small></button>'; }).join('') + '<button type="button" class="uz-switch-account-option" data-username="">Use another account</button></details>'; }
  async function signOutClient() {
    var current = cleanUsername(localStorage.getItem('uzLoginEmail') || '');
    if (current) saveAccountSettings(current);
    if (current) sessionStorage.removeItem('uzAccountRefresh:' + current);
    authTransition = true;
    sessionStorage.removeItem('uzSessionOk');
    localStorage.removeItem('uzMongoToken');
    sessionStorage.removeItem('uzMongoToken');
    if (window.UZCommunity && window.UZCommunity.logout) { try { await window.UZCommunity.logout(); } catch (e) {} }
    if (client && client.auth && !mongoMode) { try { await client.auth.signOut(); } catch (e) {} }
    localStorage.removeItem('uzLoginEmail');
    window.UZCurrentProfile = null;
    clearActiveSettings();
    authTransition = false;
  }
  function wireProfileSwitchAccounts() { Array.prototype.forEach.call(document.querySelectorAll('.uz-switch-account-option'), function(btn){ btn.onclick = async function(){ var username = btn.dataset.username || ''; await signOutClient(); authMode = 'signin'; renderGate(username ? 'Sign in to switch to ' + username + '.' : 'Sign in with another account.'); var input = document.getElementById('uz-login-user'); if (input) input.value = username; var pass = document.getElementById('uz-login-pass'); if (pass) pass.focus(); }; }); var plain = document.getElementById('uz-switch-account'); if (plain) plain.onclick = async function(){ await signOutClient(); authMode = 'signin'; renderGate('Sign in with another account.'); }; }
  async function ensureProfile(user) { if (!ready || !user) return null; if (mongoMode) return window.UZCurrentProfile || null; var username = usernameFromUser(user); var localDisplay = getName(username); var payload = { id: user.id, username: username }; if (localDisplay) payload.display_name = localDisplay; var res = await client.from('profiles').upsert(payload, { onConflict: 'id' }).select('*').single(); if (res.error) { note(res.error.message || 'Profile could not be saved.'); return null; } if (res.data && res.data.banned_until && new Date(res.data.banned_until) > new Date()) { try { localStorage.setItem('uzBannedAccount:' + cleanUsername(username), '1'); await client.auth.signOut(); } catch(e) {} renderBannedGate(username); return null; } try { localStorage.removeItem('uzBannedAccount:' + cleanUsername(username)); } catch(e) {} if (window.UZCommunity && window.UZCommunity.refresh) window.UZCommunity.refresh(); return res.data || null; }
  function logoSvg() { return '<svg class="uz-logo-svg" viewBox="0 0 96 96" aria-hidden="true"><defs><linearGradient id="uzOrange" x1="10" y1="8" x2="86" y2="90"><stop stop-color="#ffd36b"/><stop offset="0.42" stop-color="#ff7a1a"/><stop offset="1" stop-color="#d93400"/></linearGradient><filter id="uzGlow" x="-45%" y="-45%" width="190%" height="190%"><feGaussianBlur stdDeviation="4" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs><path d="M48 6 84 22v28c0 23-14 36-36 44C26 86 12 73 12 50V22L48 6Z" fill="#150704" stroke="#ff7a1a" stroke-width="4" filter="url(#uzGlow)"/><path d="M27 29h12v27c0 7 3 10 9 10s9-3 9-10V29h12v28c0 14-8 22-21 22s-21-8-21-22V29Z" fill="url(#uzOrange)"/><path d="M31 25h39L45 53h24v11H27l25-29H31V25Z" fill="#ffb347"/><path d="M20 76 78 20" stroke="#fff1c2" stroke-width="5" stroke-linecap="round" opacity=".88"/><path d="M22 78 80 22" stroke="#ff5a00" stroke-width="3" stroke-linecap="round" opacity=".95"/></svg>'; }
  function resetAuthBranding() {
    try { document.title = 'Unblocked Zone'; } catch(e) {}
    try {
      var link = document.getElementById('page-favicon') || document.querySelector('link[rel="icon"]') || document.createElement('link');
      link.id = 'page-favicon'; link.rel = 'icon'; link.type = 'image/svg+xml';
      link.href = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(logoSvg().replace(' class="uz-logo-svg"', ''));
      if (!link.parentNode) document.head.appendChild(link);
    } catch(e) {}
  }
  function renderGate(message) {
    var bannedLock = siteBannedName();
    if (bannedLock) { renderBannedGate(bannedLock); return; }
    if (!cfg.requireLogin) return;
    var oldUser = document.getElementById('uz-login-user');
    var oldPass = document.getElementById('uz-login-pass');
    var oldRemember = document.getElementById('uz-remember-me');
    var keepUser = oldUser ? oldUser.value : '';
    var keepPass = oldPass ? oldPass.value : '';
    var keepRemember = oldRemember ? oldRemember.checked : true;
    var activeId = document.activeElement && document.activeElement.id;
    document.body.classList.add('uz-auth-locked'); document.body.classList.remove('uz-app-unlocked');
    resetAuthBranding();
    var gate = document.getElementById('uz-auth-gate');
    if (!gate) { gate = document.createElement('div'); gate.id = 'uz-auth-gate'; gate.className = 'uz-auth-gate uz-auth-ms-style'; document.body.appendChild(gate); }
    var setup = !ready ? '<div class="uz-auth-setup"><b>Account service could not load</b><span>The account service is blocked or still loading on this network. Refresh once or use the latest hosted link. Accounts stay locked until the real account service loads.</span></div>' : '';
    var disabled = ready ? '' : ' disabled';
    var title = authMode === 'signup' ? 'Create your account' : 'Welcome back';
    var primary = authMode === 'signup' ? 'Create account' : 'Sign in';
    var switchText = authMode === 'signup' ? 'Already have an account? Sign in' : 'Need an account? Create one';
    wakeAccountApi();
    gate.innerHTML = '<div class="uz-auth-card"><aside class="uz-auth-art"><div class="uz-auth-wordmark">' + logoSvg() + '<div><strong>Unblocked Zone</strong><span>Remix access panel</span></div></div><div class="uz-auth-copy"><b>Choose your route.</b><span>Sign in or create a site account to continue.</span></div></aside><section class="uz-auth-form"><div class="uz-auth-tabs"><button id="uz-tab-signin" class="' + (authMode === 'signin' ? 'active' : '') + '">Sign in</button><button id="uz-tab-signup" class="' + (authMode === 'signup' ? 'active' : '') + '">Create account</button></div><h1>' + title + '</h1><p class="uz-auth-detail">Use your Unblocked Zone account. This is not a school, Google, Microsoft, or ClassLink login.</p>' + setup + recentAccountsHtml() + '<label>Username</label><input id="uz-login-user" autocomplete="username" name="username" maxlength="24" placeholder="Choose a username"><label>Password</label><div class="uz-pass-wrap"><input id="uz-login-pass" autocomplete="current-password" name="password" type="password" placeholder="At least 6 characters"><button type="button" id="uz-pass-eye" aria-label="Show password">&#128065;</button></div><label class="uz-remember-row"><input id="uz-remember-me" type="checkbox" checked> Remember this account for 30 days</label><button class="community-btn uz-auth-primary" id="uz-login-primary"' + disabled + '>' + primary + '</button><button class="uz-auth-switch" id="uz-auth-switch" type="button">' + switchText + '</button><button class="uz-auth-switch" id="uz-forgot-pass" type="button">Forgot password?</button><p class="uz-auth-detail">Passwords are protected with hashing and are not shown in plaintext.</p><p class="uz-auth-error" id="uz-auth-error">' + esc(message || '') + '</p><details class="uz-auth-debug"><summary>Debug</summary><pre id="uz-auth-debug-log">' + esc((window.UZ_ACCOUNT_DEBUG || []).slice(-12).join('\n')) + '</pre></details></section></div>';
    var userInput = document.getElementById('uz-login-user');
    var passInput2 = document.getElementById('uz-login-pass');
    var rememberInput = document.getElementById('uz-remember-me');
    if (userInput && keepUser) userInput.value = keepUser;
    if (passInput2 && keepPass) passInput2.value = keepPass;
    if (rememberInput) rememberInput.checked = keepRemember;
    if (activeId) { var active = document.getElementById(activeId); if (active) active.focus(); }
    document.getElementById('uz-tab-signin').onclick = function(){ authMode = 'signin'; renderGate(''); };
    document.getElementById('uz-tab-signup').onclick = function(){ authMode = 'signup'; renderGate(''); };
    document.getElementById('uz-auth-switch').onclick = function(){ authMode = authMode === 'signin' ? 'signup' : 'signin'; renderGate(''); };
    var ownerLink = document.getElementById('uz-owner-link'); if (ownerLink) ownerLink.onclick = showOwnerPrompt; var fp = document.getElementById('uz-forgot-pass'); if (fp) fp.onclick = forgotPassword;
    var eye = document.getElementById('uz-pass-eye'); var passInput = document.getElementById('uz-login-pass');
    if (eye && passInput) eye.onclick = function(){ var show = passInput.type === 'password'; passInput.type = show ? 'text' : 'password'; eye.classList.toggle('active', show); eye.setAttribute('aria-label', show ? 'Hide password' : 'Show password'); };
    wireRecentAccounts();
    document.getElementById('uz-login-primary').onclick = function(){ if (authMode === 'signup') signUp(); else signIn(); };
    document.getElementById('uz-login-pass').addEventListener('keydown', function(e){ if (e.key === 'Enter') { if (authMode === 'signup') signUp(); else signIn(); } });
  }
  function clearGate() { document.body.classList.remove('uz-auth-locked'); document.body.classList.add('uz-app-unlocked'); var gate = document.getElementById('uz-auth-gate'); if (gate) gate.remove(); if (window.restoreSavedCloak) window.restoreSavedCloak(); }
  function appealProofDataUrl(file) {
    if (!file) return Promise.resolve('');
    return profileImageDataUrl(file).catch(function () { throw new Error('Choose an image smaller than 8 MB for the appeal proof.'); });
  }
  async function submitBanAppeal() {
    if (!firebaseMode) { note('Appeals are available when this site is using the Firebase account database.'); return; }
    initClient();
    var user = client && client.auth && client.auth.currentUser;
    var reason = String((document.getElementById('uz-appeal-reason') || {}).value || '').trim();
    var details = String((document.getElementById('uz-appeal-details') || {}).value || '').trim();
    var proofUrl = String((document.getElementById('uz-appeal-proof-url') || {}).value || '').trim();
    var statusEl = document.getElementById('uz-appeal-status');
    if (!user) { if (statusEl) statusEl.textContent = 'Your account session is not available. Refresh and try again.'; return; }
    if (reason.length < 12 || details.length < 12) { if (statusEl) statusEl.textContent = 'Answer both appeal questions with at least 12 characters.'; return; }
    try {
      if (statusEl) statusEl.textContent = 'Checking appeal limits...';
      var profile = await client.db.collection('profiles').doc(user.uid).get();
      var profileData = profile.exists ? (profile.data() || {}) : {};
      var banKey = String(profileData.ban_id || profileData.banned_at || profileData.banned_until || 'current');
      var prior = await client.db.collection('appeals').where('user_id', '==', user.uid).limit(30).get();
      var matching = prior.docs.map(function (doc) { var data = doc.data() || {}; data.id = doc.id; return data; }).filter(function (entry) { return String(entry.ban_key || 'current') === banKey; }).sort(function (a, b) { return String(b.created_at || '').localeCompare(String(a.created_at || '')); });
      if (matching.length >= 2) throw new Error('This ban already has the maximum of two appeals.');
      if (matching[0] && Date.now() - new Date(matching[0].created_at || 0).getTime() < 86400000) throw new Error('You can submit another appeal after 24 hours.');
      var proofFileEl = document.getElementById('uz-appeal-proof-file');
      var proofImage = await appealProofDataUrl(proofFileEl && proofFileEl.files ? proofFileEl.files[0] : null);
      await client.db.collection('appeals').add({
        user_id: user.uid,
        username: cleanUsername(profileData.username || usernameFromUser(user)),
        ban_key: banKey,
        status: 'pending',
        reason: reason.slice(0, 1200),
        details: details.slice(0, 3000),
        proof_url: proofUrl.slice(0, 1000),
        proof_image: proofImage,
        created_at: new Date().toISOString()
      });
      if (statusEl) statusEl.textContent = 'Appeal submitted. Staff can review it now.';
    } catch (error) { if (statusEl) statusEl.textContent = error.message || 'Could not submit appeal.'; }
  }
  function renderBannedGate(username) {
    username = cleanUsername(username || localStorage.getItem('uzLoginEmail') || 'this account');
    try { localStorage.setItem('uzSiteBanned', username); localStorage.setItem('uzBannedAccount:' + username, '1'); if (client && client.auth && client.auth.currentUser) localStorage.setItem('uzSiteBannedUid', client.auth.currentUser.uid); } catch(e) {}
    resetAuthBranding();
    document.body.classList.add('uz-auth-locked'); document.body.classList.remove('uz-app-unlocked');
    var gate = document.getElementById('uz-auth-gate');
    if (!gate) { gate = document.createElement('div'); gate.id = 'uz-auth-gate'; gate.className = 'uz-auth-gate uz-auth-ms-style'; document.body.appendChild(gate); }
    gate.innerHTML = '<div class="uz-banned-card"><h1>Access Blocked</h1><p><b>' + esc(username || 'This account') + '</b> is banned from Unblocked Zone.</p><span>Appeals have a 24-hour cooldown and a maximum of two submissions for each ban.</span><div class="uz-appeal-form"><label>What happened?<textarea id="uz-appeal-reason" maxlength="1200" placeholder="Explain what happened."></textarea></label><label>Why should the ban be lifted?<textarea id="uz-appeal-details" maxlength="3000" placeholder="Share context, accountability, or what will change."></textarea></label><label>Proof link (optional)<input id="uz-appeal-proof-url" maxlength="1000" placeholder="https://..."></label><label class="community-file-label">Upload proof image (optional)<input id="uz-appeal-proof-file" type="file" accept="image/*"></label><button class="community-btn" id="uz-appeal-submit" type="button">Submit appeal</button><p id="uz-appeal-status" class="uz-appeal-status"></p></div></div>';
    var submit = document.getElementById('uz-appeal-submit'); if (submit) submit.onclick = submitBanAppeal;
  }
  async function forgotPassword() {
    var username = cleanUsername((document.getElementById('uz-login-user') || {}).value || '');
    if (!username) { note('Enter your username first, then press Forgot password.'); return; }
    note('Password reset needs owner/admin help for this custom account system.');
  }
  function screenFlash(kind) { document.body.classList.remove('uz-flash-good','uz-flash-bad'); void document.body.offsetWidth; document.body.classList.add(kind === 'good' ? 'uz-flash-good' : 'uz-flash-bad'); clearTimeout(screenFlash.t); screenFlash.t = setTimeout(function(){ document.body.classList.remove('uz-flash-good','uz-flash-bad'); }, 620); }
  function wireCreateAccountError() { var btn = document.getElementById('uz-create-account-error'); if (btn) btn.onclick = function(){ authMode = 'signup'; renderGate(''); var input = document.getElementById('uz-login-user'); if (input) input.focus(); }; }
  function authFail(msg) { if (msg === 'ACCOUNT_MISSING') { note('Account does not exist. Press <button type="button" id="uz-create-account-error" class="uz-auth-inline-link">Create account</button> below to make one.', true); wireCreateAccountError(); } else note(msg || 'That did not work. Check the username and password.'); screenFlash('bad'); ownerAudio('bad'); var card = document.querySelector('.uz-auth-card'); if (card) { card.classList.remove('uz-auth-shake'); void card.offsetWidth; card.classList.add('uz-auth-shake'); } }
  async function accountExists(username) { if (mongoMode) return true; try { var found = await client.from('profiles').select('id').eq('username', username).maybeSingle(); return !!(found && found.data && found.data.id); } catch(e) { return true; } }
  function loginErrorMessage(username, exists) { return exists ? 'Username or password incorrect. Try again, or press Forgot password if this is your account.' : 'ACCOUNT_MISSING'; }
  async function deleteFirebaseAuthUser(user, password) {
    if (!user || typeof user.delete !== 'function') throw new Error('Firebase Auth deletion is unavailable.');
    try {
      await user.delete();
      return true;
    } catch (firstError) {
      if (firstError.code !== 'auth/requires-recent-login') throw firstError;
      password = password || prompt('Firebase needs one recent password check to permanently delete this account:');
      if (!password) throw new Error('Account deletion cancelled.');
      if (!user.reauthenticateWithCredential || !window.firebase || !window.firebase.auth || !window.firebase.auth.EmailAuthProvider) throw firstError;
      var credential = window.firebase.auth.EmailAuthProvider.credential(user.email, password);
      await user.reauthenticateWithCredential(credential);
      await user.delete();
      return true;
    }
  }
  async function ensureFirebaseProfile(user, username, allowCreate, cleanupPassword) {
    initClient();
    username = cleanUsername(username || usernameFromUser(user));
    if (allowCreate == null) allowCreate = authMode === 'signup';
    var ref = client.db.collection('profiles').doc(user.uid);
    var deletedRef = client.db.collection('deletedAccounts').doc(user.uid);
    var deletedMarker = null;
    try { deletedMarker = await deletedRef.get(); } catch (eMarker) { debugLog('deleted-marker-check-failed', eMarker.message || 'unknown'); }
    var doc = await ref.get();
    if ((deletedMarker && deletedMarker.exists) || (doc.exists && doc.data() && doc.data().role === 'deleted')) {
      // Finish cleaning up old deletion records when the old Auth account still exists.
      // Keep the marker if Auth deletion fails so the stale account cannot be recreated.
      try {
        await deletedRef.set({ username: username, deleted_at: new Date().toISOString() }, { merge: true });
        if (doc.exists) {
          await ref.delete();
          var afterDelete = await ref.get();
          if (afterDelete.exists) throw new Error('Firebase did not confirm deleted profile cleanup.');
        }
        await deleteFirebaseAuthUser(user, cleanupPassword);
        try { await deletedRef.delete(); } catch (markerError) { debugLog('deleted-marker-cleanup-failed', markerError.message || 'unknown'); }
      } catch (cleanupError) {
        debugLog('deleted-account-cleanup-failed', cleanupError.message || 'unknown');
      }
      clearAccountLocalState(username);
      try { await client.auth.signOut(); } catch (e0) {}
      renderGate('This account was deleted. Create a new account to continue.');
      return null;
    }
    if (!doc.exists && !allowCreate) {
      clearAccountLocalState(username);
      try {
        await deleteFirebaseAuthUser(user, cleanupPassword);
        debugLog('orphan-auth-deleted', username);
      } catch (orphanError) {
        debugLog('orphan-auth-delete-failed', orphanError.message || 'unknown');
      }
      try { await client.auth.signOut(); } catch (signOutError) {}
      renderGate('This account no longer has an active profile and cannot be signed in. Create a new account to continue.');
      return null;
    }
    if (!doc.exists) {
      var role = 'member';
      await ref.set({ id: user.uid, username: username, display_name: username, role: role, warnings: 0, email: user.email || '', created_at: new Date().toISOString(), last_seen: new Date().toISOString() });
      doc = await ref.get();
    } else {
      await ref.set({ last_seen: new Date().toISOString(), email: user.email || '' }, { merge: true });
      doc = await ref.get();
    }
    var data = doc.data() || {};
    data.id = user.uid;
    window.UZPendingProfileSettings = { username: username, settings: data.settings && typeof data.settings === 'object' ? data.settings : {} };
    if (data.role === 'banned' || (data.banned_until && new Date(data.banned_until) > new Date())) { try { localStorage.setItem('uzSiteBanned', username); localStorage.setItem('uzSiteBannedUid', user.uid); localStorage.setItem('uzBannedAccount:' + username, '1'); } catch(e) {} renderBannedGate(username); return null; }
    return data;
  }
  async function finishLogin(username, session, profile) {
    setBusy('');
    username = cleanUsername(username);
    debugLog('login-finish', username);
    // Save the old account while its storage scope is still active, then switch and restore the new scope.
    var previousUsername = cleanUsername(localStorage.getItem('uzLoginEmail') || '');
    if (previousUsername && previousUsername !== username) saveAccountSettings(previousUsername);
    localStorage.setItem('uzLoginEmail', username);
    setLightspeed(username);
    restoreAccountSettings(username, profile && profile.settings);
    window.UZCurrentProfile = profile || window.UZCurrentProfile || null;
    screenFlash('good');
    ownerAudio('good');
    sessionStorage.setItem('uzSessionOk', 'true');
    saveRecentAccount(username);
    clearGate();
    renderProfile(session || mongoProfileToSession(profile), profile || window.UZCurrentProfile);
    sessionStorage.setItem('uzAccountRefresh:' + username, '1');
    if (window.UZCommunity && window.UZCommunity.refresh) {
      try { await window.UZCommunity.refresh(); } catch(e) { debugLog('community-refresh-failed', e.message || 'unknown'); }
    }
  }
  async function recoverOrphanedFirebaseAccount(username, password) {
    initClient();
    var old = await client.auth.signInWithEmailAndPassword(authEmail(username), password);
    var ref = client.db.collection('profiles').doc(old.user.uid);
    var deletedRef = client.db.collection('deletedAccounts').doc(old.user.uid);
    var doc = await ref.get();
    var marker = await deletedRef.get();
    var data = doc.exists ? (doc.data() || {}) : {};
    var orphaned = !doc.exists || data.role === 'deleted' || marker.exists;
    if (!orphaned) { try { await client.auth.signOut(); } catch (e0) {} return null; }
    if (doc.exists) await ref.delete();
    try { await deletedRef.delete(); } catch (e1) {}
    await old.user.delete();
    var replacement = await client.auth.createUserWithEmailAndPassword(authEmail(username), password);
    if (replacement.user.updateProfile) await replacement.user.updateProfile({ displayName: username }).catch(function(){});
    var profile = await ensureFirebaseProfile(replacement.user, username, true);
    return profile ? { credential: replacement, profile: profile } : null;
  }
  async function signIn() { var locked = siteBannedName(); if (locked) { renderBannedGate(locked); return; } if (!ready) { authFail('Account service is blocked or still loading on this network. Refresh once or try the latest hosted link.'); return; } initClient(); var username = cleanUsername(document.getElementById('uz-login-user').value); var password = document.getElementById('uz-login-pass').value; if (username.length < 2 || password.length < 6) { authFail('Username needs 2+ characters and password needs 6+ characters.'); return; } debugLog('signin-start', username); if (firebaseMode) { authTransition = true; try { setBusy('Signing in...'); await setFirebasePersistence(); var cred = await client.auth.signInWithEmailAndPassword(authEmail(username), password); var profile = await ensureFirebaseProfile(cred.user, username, false, password); if (profile) await finishLogin(username, firebaseProfileToSession(cred.user, profile), profile); else setBusy(''); authTransition = false; } catch(e) { authTransition = false; debugLog('firebase-signin-failed', e.message || 'unknown'); setBusy(''); removeRecentAccount(username); authFail((e.code === 'auth/user-not-found' || e.code === 'auth/invalid-credential') ? 'ACCOUNT_MISSING' : (e.message || loginErrorMessage(username, true))); } return; } if (mongoMode) { try { setBusy('Signing in...'); var data = await mongoFetch('/auth/login', { method: 'POST', body: JSON.stringify({ username: username, password: password }), timeout: 16000 }); if (rememberWanted()) localStorage.setItem('uzMongoToken', data.token); else sessionStorage.setItem('uzMongoToken', data.token); await finishLogin(username, mongoProfileToSession(data.user), data.user); } catch(e) { debugLog('signin-failed', e.message || 'unknown'); setBusy(''); if (e.data && e.data.banned) renderBannedGate(username); else authFail(e.status === 404 ? 'ACCOUNT_MISSING' : (e.message || loginErrorMessage(username, true))); } return; } var exists = await accountExists(username); if (!exists) { removeRecentAccount(username); authFail(loginErrorMessage(username, false)); return; } setBusy('Signing in...'); var res = await client.auth.signInWithPassword({ email: authEmail(username), password: password }); if (res.error) { setBusy(''); removeRecentAccount(username); authFail(loginErrorMessage(username, true)); return; } var profile = await ensureProfile(res.data.user); if (profile) await finishLogin(username, res.data.session || { user: res.data.user }, profile); else setBusy(''); }
  async function signUp() { var locked = siteBannedName(); if (locked) { renderBannedGate(locked); return; } if (!ready) { authFail('Account service is blocked or still loading on this network. Refresh once or try the latest hosted link.'); return; } initClient(); var username = cleanUsername(document.getElementById('uz-login-user').value); var password = document.getElementById('uz-login-pass').value; if (username.length < 2 || password.length < 6) { authFail('Username needs 2+ characters and password needs 6+ characters.'); return; } debugLog('signup-start', username); if (firebaseMode) { authTransition = true; try { setBusy('Creating account...'); await setFirebasePersistence(); var cred = await client.auth.createUserWithEmailAndPassword(authEmail(username), password); if (cred.user.updateProfile) await cred.user.updateProfile({ displayName: username }).catch(function(){}); var profile = await ensureFirebaseProfile(cred.user, username); if (profile) await finishLogin(username, firebaseProfileToSession(cred.user, profile), profile); else setBusy(''); authTransition = false; } catch(e) { debugLog('firebase-signup-failed', e.message || 'unknown'); if (e.code === 'auth/email-already-in-use') { try { setBusy('Repairing old account...'); var recovered = await recoverOrphanedFirebaseAccount(username, password); if (recovered) { await finishLogin(username, firebaseProfileToSession(recovered.credential.user, recovered.profile), recovered.profile); authTransition = false; return; } } catch(recoveryError) { debugLog('orphan-recovery-failed', recoveryError.message || 'unknown'); } } authTransition = false; setBusy(''); authFail(e.code === 'auth/email-already-in-use' ? 'Account already exists. Use Sign in instead.' : (e.message || 'Could not create account.')); } return; } if (mongoMode) { try { setBusy('Creating account...'); var data = await mongoFetch('/auth/signup', { method: 'POST', body: JSON.stringify({ username: username, password: password }), timeout: 16000 }); if (rememberWanted()) localStorage.setItem('uzMongoToken', data.token); else sessionStorage.setItem('uzMongoToken', data.token); await finishLogin(username, mongoProfileToSession(data.user), data.user); } catch(e) { debugLog('signup-failed', e.message || 'unknown'); setBusy(''); authFail(e.message || 'Could not create account.'); } return; } setBusy('Creating account...'); var res = await client.auth.signUp({ email: authEmail(username), password: password, options: { data: { username: username } } }); if (res.error) { setBusy(''); authFail(res.error.message); return; } var profile = await ensureProfile(res.data.user); if (profile) await finishLogin(username, res.data.session || { user: res.data.user }, profile); else setBusy(''); }

  function updateProfileReady() {
    var mount = document.getElementById('uz-profile-menu');
    if (!mount) return;
    var loading = document.getElementById('loading-screen');
    var boot = document.getElementById('boot-screen');
    var busy = (loading && loading.style.display !== 'none' && !loading.classList.contains('hidden')) || (boot && boot.style.display !== 'none' && !boot.classList.contains('hidden'));
    mount.classList.toggle('uz-profile-ready', !busy);
  }
  function renderProfile(session, profile) {
    if (!session && !profile && !isTempOwner()) { var old = document.getElementById('uz-profile-menu'); if (old) old.remove(); return; }
    var mount = document.getElementById('uz-profile-menu');
    if (!mount) { mount = document.createElement('div'); mount.id = 'uz-profile-menu'; mount.className = 'uz-profile-menu'; document.body.appendChild(mount); if (window.MutationObserver) { var obs = new MutationObserver(updateProfileReady); ['loading-screen','boot-screen'].forEach(function(id){ var el = document.getElementById(id); if (el) obs.observe(el, { attributes: true, attributeFilter: ['class','style'] }); }); } } updateProfileReady();
    var user = session && session.user;
    var username = (profile && profile.username) || usernameFromUser(user) || localStorage.getItem('uzLoginEmail') || '';
    window.UZCurrentProfile = profile || null; var owner = (profile && profile.role === 'owner') || isTempOwner();
    var temporary = isTempOwner() && !user;
    var savedName = temporary ? '' : getName(username);
    var name = temporary ? 'Temporary Owner' : (savedName || (profile && profile.display_name) || username || 'Profile');
    var avatar = temporary ? '' : (getAvatar(username) || ((profile && profile.avatar_url) || ''));
    var disabled = temporary ? ' disabled' : '';
    var readonlyNote = temporary ? '<p class="uz-profile-note">Temporary owner mode cannot save profile names, images, or account settings.</p>' : '';
    var passwordTools = temporary ? '' : '<details class="uz-account-tools"><summary>Account security</summary><button class="community-btn secondary" id="uz-password-save" type="button">Forgot / reset password</button></details>';
    var switchButton = temporary ? '' : switchAccountsHtml(username);
    var deleteButton = temporary ? '' : '<button class="community-btn danger" id="uz-profile-delete">Delete account</button>';
    mount.innerHTML = '<button class="uz-profile-chip" id="uz-profile-toggle"><span class="uz-profile-avatar">' + (avatar ? '<img src="' + esc(avatar) + '" alt="">' : esc(name.charAt(0).toUpperCase() || 'P')) + '</span><span>' + esc(name) + '</span></button><div class="uz-profile-panel" id="uz-profile-panel"><label>Display name</label><input id="uz-profile-name" maxlength="24" value="' + esc(savedName) + '" placeholder="Choose a name"' + disabled + '><label>Image URL</label><input id="uz-profile-avatar" value="' + esc(avatar) + '" placeholder="https://..."' + disabled + '><label class="community-file-label">Upload profile image<input id="uz-profile-avatar-file" type="file" accept="image/*"' + disabled + '></label><span class="uz-profile-upload-note" id="uz-profile-upload-note">Images are resized before saving.</span><div class="community-row"><button class="community-btn" id="uz-profile-save"' + disabled + '>Save</button><button class="community-btn secondary" id="uz-profile-open" type="button">Expand profile settings</button><button class="community-btn secondary" id="uz-profile-logout">Log out</button></div>' + switchButton + passwordTools + deleteButton + readonlyNote + '<p>Account: <b>' + esc(username || 'Not signed in') + '</b></p><p>Role: <b>' + esc(owner ? 'owner' : 'member') + '</b></p></div>';
    document.getElementById('uz-profile-toggle').onclick = function () { document.getElementById('uz-profile-panel').classList.toggle('open'); };
    var openProfile = document.getElementById('uz-profile-open');
    if (openProfile) openProfile.onclick = function () { openProfileSettings(username, name, avatar, owner, temporary); };
    var avatarFile = document.getElementById('uz-profile-avatar-file');
    if (avatarFile && !temporary) avatarFile.onchange = async function () {
      var note = document.getElementById('uz-profile-upload-note');
      try {
        if (note) note.textContent = 'Preparing image...';
        var value = await profileImageDataUrl(avatarFile.files && avatarFile.files[0]);
        document.getElementById('uz-profile-avatar').value = value;
        if (note) note.textContent = 'Image ready. Press Save to update your profile.';
      } catch (error) { if (note) note.textContent = error.message || 'Image upload failed.'; }
    };
    var save = document.getElementById('uz-profile-save');
    if (save && !temporary) save.onclick = async function () {
      var n = document.getElementById('uz-profile-name').value.replace(/\s+/g, ' ').trim().slice(0, cfg.maxNameLength || 24);
      var a = document.getElementById('uz-profile-avatar').value.trim();
      try {
        if (window.UZCommunity && window.UZCommunity.updateProfile) await window.UZCommunity.updateProfile(n, a);
        else if (window.UZCommunity && window.UZCommunity.saveProfile) await window.UZCommunity.saveProfile();
        localStorage.setItem(profileKey('uzCommunityProfileName', username), n);
        localStorage.setItem(profileKey('uzCommunityAvatar', username), a);
      } catch (error) {
        var uploadNote = document.getElementById('uz-profile-upload-note');
        if (uploadNote) uploadNote.textContent = error.message || 'Profile could not be saved.';
        return;
      }
      var toast = document.getElementById('uz-autosave-note');
      if (toast) { toast.textContent = 'Profile saved to your account'; toast.classList.add('show'); setTimeout(function(){ toast.classList.remove('show'); }, 1500); }
      check();
    };
    var passBtn = document.getElementById('uz-password-save');
    if (passBtn) passBtn.onclick = async function () { await forgotPassword(); }; wireProfileSwitchAccounts();
    var del = document.getElementById('uz-profile-delete');
    if (del) del.onclick = async function () { await deleteAccount(username); };
    document.getElementById('uz-profile-logout').onclick = async function () { tempOwnerActive = false; window.UZTempOwnerActive = false; authMode = 'signin'; await signOutClient(); renderProfile(null, null); renderGate('Signed out.'); };
  }
  function openProfileSettings(username, name, avatar, owner, temporary) {
    var existing = document.getElementById('uz-profile-modal');
    if (existing) existing.remove();
    var modal = document.createElement('div');
    modal.id = 'uz-profile-modal';
    modal.className = 'uz-profile-modal';
    modal.innerHTML = '<div class="uz-profile-modal-card"><button class="uz-profile-modal-close" id="uz-profile-modal-close">Close</button><h2>Profile settings</h2><div class="uz-profile-modal-grid"><section><h3>Account</h3><p>Username: <b>' + esc(username || 'Not signed in') + '</b></p><p>Role: <b>' + esc(owner ? 'owner' : 'member') + '</b></p><p>' + (temporary ? 'Temporary owner mode resets on refresh and cannot save account settings.' : 'Profile changes save only for this account.') + '</p></section><section><h3>Personalization</h3><p>Display name and image stay account-scoped. Site settings are also stored per account after login.</p><p>Use the small profile menu to edit name/image quickly.</p></section><section><h3>Security</h3><p>Use Account security in the profile menu to change your password or delete your account.</p></section></div></div>';
    document.body.appendChild(modal);
    document.getElementById('uz-profile-modal-close').onclick = function(){ modal.remove(); };
    modal.addEventListener('click', function(e){ if (e.target === modal) modal.remove(); });
  }
  async function changePassword() { return forgotPassword(); }
  async function deleteAccount(username) {
    if (!ready || isTempOwner()) return;
    var typed = prompt('Type your exact username to delete this account:');
    if (typed !== username) { note('Account deletion cancelled. Username did not match.'); return; }
    if (!confirm('Delete account "' + username + '"? This cannot be undone.')) return;
    if (firebaseMode) {
      var ref = null;
      var snapshot = null;
      var profileDeleted = false;
      var deletedRef = null;
      var authDeleted = false;
      authTransition = true;
      try {
        initClient();
        var user = client.auth.currentUser;
        if (!user) throw new Error('This account is no longer signed in.');
        ref = client.db.collection('profiles').doc(user.uid);
        snapshot = await ref.get();
        deletedRef = client.db.collection('deletedAccounts').doc(user.uid);
        if (snapshot.exists) {
          await ref.delete();
          profileDeleted = true;
          var afterDelete = await ref.get();
          if (afterDelete.exists) throw new Error('Firebase did not confirm profile deletion.');
        }
        await deleteFirebaseAuthUser(user);
        authDeleted = true;
        try { await deletedRef.delete(); } catch (markerError) { debugLog('deleted-marker-cleanup-failed', markerError.message || 'unknown'); }
        clearAccountLocalState(username);
        localStorage.removeItem('uzSiteBanned');
        localStorage.removeItem('uzSiteBannedUid');
        localStorage.removeItem('uzBannedAccount:' + cleanUsername(username));
        localStorage.removeItem('uzLoginEmail');
        sessionStorage.removeItem('uzSessionOk');
        sessionStorage.removeItem('uzAccountRefresh:' + cleanUsername(username));
        try { await client.auth.signOut(); } catch (e) {}
        window.UZCurrentProfile = null;
        clearActiveSettings();
        renderProfile(null, null);
        authMode = 'signin';
        renderGate('Account deleted permanently.');
      } catch (e) {
        if (profileDeleted && snapshot && snapshot.exists && ref) {
          try { await ref.set(snapshot.data()); } catch (restoreError) { debugLog('profile-restore-failed', restoreError.message || 'unknown'); }
        }
        note(e.message || 'Account deletion failed.');
      } finally {
        authTransition = false;
      }
      return;
    }
    if (mongoMode) {
      try {
        await mongoFetch('/account', { method: 'DELETE', timeout: 16000 });
        localStorage.removeItem('uzLoginEmail');
        sessionStorage.removeItem('uzSessionOk');
        sessionStorage.removeItem('uzAccountRefresh:' + cleanUsername(username));
        removeRecentAccount(username);
        clearActiveSettings();
        renderProfile(null, null);
        renderGate('Account deleted permanently.');
      } catch (e2) { note(e2.message || 'Account deletion failed.'); }
      return;
    }
    note('Account deletion is only available after Firebase is configured.');
  }

  function ownerAudio(kind) {
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      var ctx = new Ctx();
      if (kind === 'good') {
        [523, 784].forEach(function(freq, i){
          var o = ctx.createOscillator();
          var g = ctx.createGain();
          var t = ctx.currentTime + i * .11;
          o.type = 'sine';
          o.frequency.setValueAtTime(freq, t);
          g.gain.setValueAtTime(.0001, t);
          g.gain.exponentialRampToValueAtTime(.16, t + .015);
          g.gain.exponentialRampToValueAtTime(.0001, t + .18);
          o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + .2);
        });
        return;
      }
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = kind === 'bad' ? 'sawtooth' : 'triangle';
      osc.frequency.setValueAtTime(kind === 'crack' ? 92 : (kind === 'bad' ? 140 : 240), ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(kind === 'good' ? 760 : 58, ctx.currentTime + .22);
      gain.gain.setValueAtTime(.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(kind === 'crack' ? .18 : .12, ctx.currentTime + .025);
      gain.gain.exponentialRampToValueAtTime(.0001, ctx.currentTime + .32);
      osc.connect(gain); gain.connect(ctx.destination); osc.start(); osc.stop(ctx.currentTime + .34);
    } catch(e) {}
  }
  function ownerRift(progress, opened) {
    var rift = document.getElementById('uz-owner-rift');
    if (!rift) { rift = document.createElement('div'); rift.id = 'uz-owner-rift'; rift.className = 'uz-owner-rift'; rift.innerHTML = '<i></i><b></b><span></span><em></em><em></em><em></em><em></em><em></em><em></em>'; document.body.appendChild(rift); }
    rift.classList.remove('closing');
    progress = Math.max(.08, Math.min(1, progress || .08));
    ownerRift.progress = progress;
    rift.style.setProperty('--rift-open', progress);
    rift.style.setProperty('--rift-gap', (2 + progress * 18) + 'vw');
    rift.style.setProperty('--rift-line', Math.min(14, 2 + progress * 12) + 'px');
    rift.style.setProperty('--branch-len', (4 + progress * 28) + 'vw');
    rift.classList.toggle('open', !!opened);
    document.body.classList.add('uz-owner-quake');
    clearTimeout(ownerRift.t);
    ownerRift.t = setTimeout(function(){ document.body.classList.remove('uz-owner-quake'); }, 260);
    ownerAudio(opened ? 'good' : 'crack');
    clearTimeout(ownerRift.decayStart);
    clearInterval(ownerRift.decayTimer);
    if (!opened) {
      ownerRift.decayStart = setTimeout(function(){
        ownerRift.decayTimer = setInterval(function(){
          ownerRift.progress = Math.max(0, (ownerRift.progress || 0) - .035);
          var rr = document.getElementById('uz-owner-rift');
          if (!rr || ownerRift.progress <= .05) { clearInterval(ownerRift.decayTimer); closeOwnerRift(); return; }
          rr.style.setProperty('--rift-open', ownerRift.progress);
          rr.style.setProperty('--rift-gap', (2 + ownerRift.progress * 18) + 'vw');
          rr.style.setProperty('--rift-line', Math.min(14, 2 + ownerRift.progress * 12) + 'px');
          rr.style.setProperty('--branch-len', (4 + ownerRift.progress * 28) + 'vw');
        }, 85);
      }, 720);
    }
    return rift;
  }
  function closeOwnerRift() { clearTimeout(ownerRift.decayStart); clearInterval(ownerRift.decayTimer); var r = document.getElementById('uz-owner-rift'); if (r) { r.classList.add('closing'); clearTimeout(closeOwnerRift.t); closeOwnerRift.t = setTimeout(function(){ var rr = document.getElementById('uz-owner-rift'); if (rr) rr.remove(); }, 900); } }
  function sparkle() { var r = ownerRift(1, true); if (r) r.classList.add('final-open'); for (var i = 0; i < 46; i++) { var s = document.createElement('i'); s.className = 'uz-owner-spark'; s.style.setProperty('--spark-x', ((Math.random() * 360) - 180) + 'px'); s.style.setProperty('--spark-y', ((Math.random() * 280) - 140) + 'px'); document.body.appendChild(s); setTimeout(function(el){ return function(){ el.remove(); }; }(s), 950); } }
  function ownerGlassFx(reverse) {
    var old = document.getElementById('uz-glass-break');
    if (old) old.remove();
    var wrap = document.createElement('div');
    wrap.id = 'uz-glass-break';
    wrap.className = 'uz-glass-break' + (reverse ? ' reverse' : '');
    for (var i = 0; i < 64; i++) {
      var shard = document.createElement('i');
      shard.style.left = (Math.random() * 100) + 'vw';
      shard.style.top = (Math.random() * 76) + 'vh';
      shard.style.setProperty('--rx', ((Math.random() * 240) - 120) + 'px');
      shard.style.setProperty('--fall', (260 + Math.random() * 520) + 'px');
      shard.style.setProperty('--rot', ((Math.random() * 520) - 260) + 'deg');
      shard.style.animationDelay = (Math.random() * .16) + 's';
      wrap.appendChild(shard);
    }
    document.body.appendChild(wrap);
    ownerAudio(reverse ? 'bad' : 'crack');
    setTimeout(function(){ wrap.remove(); }, reverse ? 900 : 1300);
  }
  function fakeOwnerLogin(done) {
    authMode = 'signin';
    renderGate('Signing out current account...');
    var user = document.getElementById('uz-login-user');
    var pass = document.getElementById('uz-login-pass');
    var primary = document.getElementById('uz-login-primary');
    var username = 'temporary-owner';
    var chars = '0123456789abcdefUZOWNER';
    var i = 0;
    var steps = username.length * 2 + 4;
    function tick() {
      if (i < steps) {
        if (user) user.value = username.slice(0, Math.min(username.length, Math.ceil(i / 2)));
        if (pass) pass.value += chars.charAt(Math.floor(Math.random() * chars.length));
        ownerAudio('crack');
        i++;
        setTimeout(tick, 34);
        return;
      }
      if (primary) { primary.textContent = 'Verifying...'; primary.classList.add('is-loading'); }
      screenFlash('good');
      ownerAudio('good');
      setTimeout(done, 520);
    }
    setTimeout(tick, 160);
  }
  async function showOwnerPrompt() { if (!document.body.classList.contains('uz-auth-locked')) return; initClient(); if (mongoMode && mongoToken()) { localStorage.removeItem('uzMongoToken'); sessionStorage.removeItem('uzMongoToken'); sessionStorage.removeItem('uzSessionOk'); localStorage.removeItem('uzLoginEmail'); renderGate('Signed out. Enter the owner code while logged out.'); return; } if (firebaseMode && client && client.auth.currentUser) { await client.auth.signOut(); sessionStorage.removeItem('uzSessionOk'); localStorage.removeItem('uzLoginEmail'); authMode = 'signin'; renderGate('Signed out. Enter the owner code while logged out.'); return; } if (client && !mongoMode && !firebaseMode) { try { var s = await client.auth.getSession(); if (s.data && s.data.session) { await client.auth.signOut(); sessionStorage.removeItem('uzSessionOk'); localStorage.removeItem('uzLoginEmail'); renderGate('Signed out. Enter the owner code while logged out.'); return; } } catch(e) {} } var existing = document.getElementById('uz-owner-code-modal'); if (existing) existing.remove(); ownerRift(1, true); ownerGlassFx(false); var modal = document.createElement('div'); modal.id = 'uz-owner-code-modal'; modal.className = 'uz-owner-code-modal from-rift'; modal.innerHTML = '<div class="uz-owner-code-card"><h2>Owner unlock</h2><p>Enter your 32-character temporary owner code. This unlock lasts until refresh or tab close.</p><input id="uz-owner-code-input" type="password" maxlength="64" autocomplete="off" placeholder="32-character raw code"><div class="community-row"><button class="community-btn" id="uz-owner-code-submit">Unlock</button><button class="community-btn secondary" id="uz-owner-code-cancel">Cancel</button></div><p id="uz-owner-code-error" class="uz-auth-error"></p></div>'; document.body.appendChild(modal); var input = document.getElementById('uz-owner-code-input'); var err = document.getElementById('uz-owner-code-error'); async function submit() { var code = input.value.trim(); if (code.length === 64 && /^[a-f0-9]{64}$/i.test(code)) { err.textContent = 'Enter the raw unlock code, not the stored hash.'; screenFlash('bad'); ownerAudio('bad'); ownerGlassFx(true); modal.classList.add('uz-auth-shake'); return; } if (code.length !== 32) { err.textContent = 'Enter the 32-character raw unlock code.'; screenFlash('bad'); ownerAudio('bad'); ownerGlassFx(true); modal.classList.add('uz-auth-shake'); return; } if (!bypassCodeReady()) { err.textContent = 'Owner unlock is not configured yet.'; screenFlash('bad'); ownerAudio('bad'); ownerGlassFx(true); return; } var codeHash = await sha256Hex(code); if (codeHash !== cfg.ownerBypassHash) { err.textContent = 'Wrong code.'; screenFlash('bad'); ownerAudio('bad'); ownerGlassFx(true); input.value = ''; input.focus(); modal.classList.remove('uz-auth-shake'); void modal.offsetWidth; modal.classList.add('uz-auth-shake'); return; } sessionStorage.removeItem('uzSessionOk'); localStorage.removeItem('uzLoginEmail'); modal.classList.add('accepted'); modal.remove(); fakeOwnerLogin(function(){ window.UZCurrentProfile = { username: 'temporary-owner', role: 'owner' }; tempOwnerActive = true; window.UZTempOwnerActive = true; setLightspeed('temporary-owner'); screenFlash('good'); sparkle(); setTimeout(function(){ closeOwnerRift(); check(); }, 820); }); } document.getElementById('uz-owner-code-submit').onclick = submit; document.getElementById('uz-owner-code-cancel').onclick = function () { modal.remove(); closeOwnerRift(); }; input.addEventListener('keydown', function(e){ if (e.key === 'Enter') submit(); if (e.key === 'Escape') { modal.remove(); closeOwnerRift(); } }); setTimeout(function(){ input.focus(); }, 180); }
  // This override intentionally preserves the ban screen while the temporary owner code is entered.
  async function showOwnerPrompt() {
    if (!document.body.classList.contains('uz-auth-locked')) return;
    initClient();
    if (mongoMode && mongoToken()) {
      localStorage.removeItem('uzMongoToken'); sessionStorage.removeItem('uzMongoToken');
      sessionStorage.removeItem('uzSessionOk'); localStorage.removeItem('uzLoginEmail');
    } else if (firebaseMode && client && client.auth.currentUser) {
      await client.auth.signOut(); sessionStorage.removeItem('uzSessionOk'); localStorage.removeItem('uzLoginEmail');
    } else if (client && !mongoMode && !firebaseMode) {
      try { var session = await client.auth.getSession(); if (session.data && session.data.session) { await client.auth.signOut(); sessionStorage.removeItem('uzSessionOk'); localStorage.removeItem('uzLoginEmail'); } } catch(e) {}
    }
    var existing = document.getElementById('uz-owner-code-modal'); if (existing) existing.remove();
    ownerRift(1, true); ownerGlassFx(false);
    var modal = document.createElement('div');
    modal.id = 'uz-owner-code-modal'; modal.className = 'uz-owner-code-modal from-rift';
    modal.innerHTML = '<div class="uz-owner-code-card"><h2>Owner unlock</h2><p>Enter your 32-character temporary owner code. This unlock lasts until refresh or tab close.</p><input id="uz-owner-code-input" type="password" maxlength="64" autocomplete="off" placeholder="32-character raw code"><div class="community-row"><button class="community-btn" id="uz-owner-code-submit">Unlock</button><button class="community-btn secondary" id="uz-owner-code-cancel">Cancel</button></div><p id="uz-owner-code-error" class="uz-auth-error"></p></div>';
    document.body.appendChild(modal);
    var input = document.getElementById('uz-owner-code-input'); var err = document.getElementById('uz-owner-code-error');
    async function submit() {
      var code = input.value.trim();
      if (code.length === 64 && /^[a-f0-9]{64}$/i.test(code)) { err.textContent = 'Enter the raw unlock code, not the stored hash.'; return; }
      if (code.length !== 32) { err.textContent = 'Enter the 32-character raw unlock code.'; return; }
      if (!bypassCodeReady()) { err.textContent = 'Owner unlock is not configured yet.'; return; }
      if (await sha256Hex(code) !== cfg.ownerBypassHash) { err.textContent = 'Wrong code.'; input.value = ''; input.focus(); return; }
      sessionStorage.removeItem('uzSessionOk'); localStorage.removeItem('uzLoginEmail');
      modal.remove();
      fakeOwnerLogin(function(){
        window.UZCurrentProfile = { username: 'temporary-owner', role: 'owner' };
        tempOwnerActive = true; window.UZTempOwnerActive = true;
        setLightspeed('temporary-owner'); screenFlash('good'); sparkle();
        setTimeout(function(){ closeOwnerRift(); check(); }, 400);
      });
    }
    document.getElementById('uz-owner-code-submit').onclick = submit;
    document.getElementById('uz-owner-code-cancel').onclick = function(){ modal.remove(); closeOwnerRift(); };
    input.addEventListener('keydown', function(e){ if (e.key === 'Enter') submit(); if (e.key === 'Escape') { modal.remove(); closeOwnerRift(); } });
    setTimeout(function(){ input.focus(); }, 80);
  }
  async function check() { if (authTransition) return; if (isTempOwner()) { setLightspeed('temporary-owner'); clearGate(); renderProfile(null, { username: 'temporary-owner', role: 'owner' }); if (window.UZCommunity && window.UZCommunity.refresh) window.UZCommunity.refresh(); return; } initClient(); if (!cfg.requireLogin && !firebaseMode && (!mongoMode || !mongoToken())) { clearGate(); renderProfile(null, null); if (window.UZCommunity && window.UZCommunity.refresh) window.UZCommunity.refresh(); return; } if (!ready) { renderProfile(null, null); renderGate(''); return; } if (firebaseMode) { var fbUser = client.auth.currentUser; var locked = siteBannedName(); var storedName = cleanUsername(localStorage.getItem('uzLoginEmail') || ''); var fbName = cleanUsername(usernameFromUser(fbUser)); if (fbUser && storedName && fbName && storedName !== fbName) { authTransition = true; try { await client.auth.signOut(); } catch (e) {} authTransition = false; fbUser = null; localStorage.removeItem('uzLoginEmail'); clearActiveSettings(); } if (!fbUser) { renderProfile(null, null); if (locked) renderBannedGate(locked); else renderGate(''); return; } var fbProfile = await ensureFirebaseProfile(fbUser, fbName); if (!fbProfile) { setBusy(''); return; } if (fbProfile.role === 'banned' || (fbProfile.banned_until && new Date(fbProfile.banned_until) > new Date())) { try { await client.auth.signOut(); } catch(e) {} renderProfile(null, null); renderBannedGate(fbProfile.username || fbName); return; } try { localStorage.removeItem('uzSiteBanned'); localStorage.removeItem('uzSiteBannedUid'); localStorage.removeItem('uzBannedAccount:' + cleanUsername(fbProfile.username)); } catch(e) {} prepareAccountSettings(fbProfile.username); setLightspeed(fbProfile.username); clearGate(); renderProfile(firebaseProfileToSession(fbUser, fbProfile), fbProfile); if (window.UZCommunity && window.UZCommunity.refresh) window.UZCommunity.refresh(); return; } var locked = siteBannedName(); if (locked) { renderProfile(null, null); renderBannedGate(locked); return; } if (mongoMode) { if (!mongoToken()) { renderProfile(null, null); renderGate(''); return; } try { var mine = await mongoFetch('/me'); window.UZCurrentProfile = mine.user; prepareAccountSettings(mine.user.username); setLightspeed(mine.user.username); clearGate(); renderProfile(mongoProfileToSession(mine.user), mine.user); if (window.UZCommunity && window.UZCommunity.refresh) window.UZCommunity.refresh(); } catch(e) { var oldName = localStorage.getItem('uzLoginEmail') || 'this account'; localStorage.removeItem('uzMongoToken'); sessionStorage.removeItem('uzMongoToken'); localStorage.removeItem('uzLoginEmail'); clearActiveSettings(); if (e.data && e.data.banned) renderBannedGate(oldName); else if (cfg.requireLogin) renderGate(e.message || 'Sign in again.'); else { clearGate(); renderProfile(null, null); } } return; } var res = await client.auth.getSession(); var session = res.data && res.data.session; if (!session || !session.user) { renderProfile(null, null); renderGate(''); return; } var profile = await ensureProfile(session.user); var username = (profile && profile.username) || usernameFromUser(session.user); if (profile && profile.banned_until && new Date(profile.banned_until) > new Date()) { await client.auth.signOut(); localStorage.removeItem('uzLoginEmail'); renderBannedGate(username); return; } prepareAccountSettings(username); setLightspeed(username); clearGate(); renderProfile(session, profile); }
  document.addEventListener('keydown', function (e) { if (!document.body.classList.contains('uz-auth-locked')) { konamiIndex = 0; return; } var key = e.key.length === 1 ? e.key.toLowerCase() : e.key; if (key === konami[konamiIndex]) { konamiIndex++; ownerRift(konamiIndex / konami.length, false); } else { konamiIndex = key === konami[0] ? 1 : 0; if (konamiIndex) ownerRift(konamiIndex / konami.length, false); } if (konamiIndex === konami.length) { konamiIndex = 0; showOwnerPrompt(); } }, true);
  window.UZAuthGate = { refresh: check, showBanned: renderBannedGate, showLogin: function(msg){ tempOwnerActive=false; window.UZTempOwnerActive=false; renderGate(msg || ''); } };
  window.UZ_ACCOUNT_DEBUG.push('auth-gate-ready');
  function saveCurrentAccountSettings() { var current = cleanUsername(localStorage.getItem('uzLoginEmail') || ''); if (current) saveAccountSettings(current); }
  window.addEventListener('pagehide', saveCurrentAccountSettings);
  window.addEventListener('beforeunload', saveCurrentAccountSettings);
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') saveCurrentAccountSettings(); });
  if (ready && firebaseMode) {
    initClient();
    client.auth.onAuthStateChanged(function (user) {
      // Firebase persistence is authoritative after a refresh. If an old local
      // username is still present, save its settings before adopting the user
      // that Firebase actually restored instead of signing that user out.
      if (user) {
        var restoredName = cleanUsername(usernameFromUser(user));
        var previousName = cleanUsername(localStorage.getItem('uzLoginEmail') || '');
        if (restoredName && previousName && restoredName !== previousName) saveAccountSettings(previousName);
        if (restoredName) localStorage.setItem('uzLoginEmail', restoredName);
      }
      check();
    });
  }
  else if (ready && !mongoMode) { initClient(); client.auth.onAuthStateChange(check); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function(){ if (!firebaseMode) check(); updateProfileReady(); }); else { if (!firebaseMode) check(); updateProfileReady(); } window.addEventListener('load', updateProfileReady);
}());
