window.UZ_COMMUNITY_CONFIG = {
  supabaseUrl: '',
  supabaseAnonKey: '',
  authProvider: 'mongo',
  firebaseConfig: {},
  // Set by the single-file loader to the public API that you deploy.
  // There is deliberately no third-party fallback here.
  mongoApiUrl: String(window.UZ_MONGO_API_URL || '').replace(/\/+$/, ''),
  internalAuthDomain: 'zone.local',
  ownerUsernames: '',
  ownerBypassHash: '',
  requireLogin: true,
  minNameLength: 2,
  maxNameLength: 24,
  blockedWords: ['fuck','shit','bitch','asshole','nigger','nigga','faggot','retard','cunt','kike','spic','chink','coon','whore','slut','rape','porn','sex']
};
window.UZ_ACCOUNT_DEBUG = window.UZ_ACCOUNT_DEBUG || [];
window.UZ_ACCOUNT_DEBUG.push('config-loaded:' + window.UZ_COMMUNITY_CONFIG.mongoApiUrl);
