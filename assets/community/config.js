window.UZ_COMMUNITY_CONFIG = {
  supabaseUrl: '',
  supabaseAnonKey: '',
  // Accounts and chat use Google Firebase, like the original site. Google's domains are
  // normally allowed on school networks, unlike onrender.com.
  authProvider: 'firebase',
  // PASTE YOUR OWN Firebase web app values here (Firebase console > Project settings > Your apps).
  firebaseConfig: {
    apiKey: "AIzaSyDFmLIqCDlRTJ3e_ZkamU50GskSC_es03Y",
    authDomain: "g4m3s-123.firebaseapp.com",
    projectId: "g4m3s-123",
    appId: "1:557119756406:web:7a3e5fd0e2b1bb67bb2757",
  },
  mongoApiUrl: '',
  // Usernames are turned into a made-up email address with this ending. Nothing is ever sent to it.
  internalAuthDomain: 'uzlogin.net',
  ownerUsernames: '',
  ownerBypassHash: '',
  requireLogin: true,
  minNameLength: 2,
  maxNameLength: 24,
  blockedWords: ['fuck','shit','bitch','asshole','nigger','nigga','faggot','retard','cunt','kike','spic','chink','coon','whore','slut','rape','porn','sex']
};
window.UZ_ACCOUNT_DEBUG = window.UZ_ACCOUNT_DEBUG || [];
window.UZ_ACCOUNT_DEBUG.push('config-loaded:firebase:' + (window.UZ_COMMUNITY_CONFIG.firebaseConfig.projectId || ''));