window.UZ_NORMALIZE_API_URL = function(value) {
  var url = String(value || '').trim().replace(/\/+$/, '');
  url = url.replace('onrendered.com', 'onrender.com');
  url = url.replace('https://zone.onrender.com', 'https://unblocked-zone.onrender.com');
  if (/^https:\/\/bullbestyoutuber\.s3\.us-east-1\.amazonaws\.com\/index\.html/i.test(url)) url = 'https://unblocked-zone.onrender.com';
  return url;
};
try {
  var savedApi = localStorage.getItem('uzMongoApiUrl');
  var fixedApi = window.UZ_NORMALIZE_API_URL(savedApi);
  if (savedApi && fixedApi !== savedApi.replace(/\/+$/, '')) localStorage.setItem('uzMongoApiUrl', fixedApi);
} catch(e) {}
window.UZ_COMMUNITY_CONFIG = {
  supabaseUrl: '',
  supabaseAnonKey: '',
  authProvider: 'firebase',
  firebaseConfig: {
    apiKey: 'AIzaSyD-ntSJGAP7hihz3_whKq0FCCR5HWsMiOo',
    authDomain: 'unbl0ck3d-z0ne.firebaseapp.com',
    projectId: 'unbl0ck3d-z0ne',
    appId: '1:376137833575:web:97e31ef3411864551ac8c2'
  },
  mongoApiUrl: '',
  internalAuthDomain: 'uzlogin.net',
  ownerUsernames: '',
  ownerBypassHash: '7e72ea0dcee964fa6f5220219cad4ceaf6e4e8caf27d29fb788dbb6d1eabc90f',
  requireLogin: true,
  minNameLength: 2,
  maxNameLength: 24,
  blockedWords: ['fuck','shit','bitch','asshole','nigger','nigga','faggot','retard','cunt','kike','spic','chink','coon','whore','slut','rape','porn','sex']
};
window.UZ_ACCOUNT_DEBUG = window.UZ_ACCOUNT_DEBUG || [];
window.UZ_ACCOUNT_DEBUG.push('config-loaded:' + window.UZ_COMMUNITY_CONFIG.mongoApiUrl);
