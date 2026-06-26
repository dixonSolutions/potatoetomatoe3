/**
 * Ad-free Unity WebGL host page for Shrek Swamp Escape 2.
 * Play button gate — Unity loads only on click (offline, no ad splash).
 */
export function buildAdFreeHostHtml(): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no"/>
  <title>Shrek Swamp Escape 2</title>
  <link rel="stylesheet" href="style.css"/>
  <style>
    canvas:focus { outline: none; }
    html, body {
      padding: 0; margin: 0; overflow: hidden; height: 100%;
      -webkit-touch-callout: none; user-select: none;
    }
    #play-cover {
      position: fixed;
      inset: 0;
      z-index: 10;
      display: flex;
      align-items: center;
      justify-content: center;
      background: url('background.jpg') center / cover no-repeat;
    }
    #play-cover::before {
      content: '';
      position: absolute;
      inset: 0;
      background: rgba(0, 0, 0, 0.35);
    }
    #play-button {
      position: relative;
      z-index: 1;
      font: 700 1.375rem/1 system-ui, -apple-system, 'Segoe UI', sans-serif;
      letter-spacing: 0.04em;
      padding: 1rem 3.5rem;
      border: 2px solid rgba(255, 255, 255, 0.85);
      border-radius: 999px;
      background: linear-gradient(180deg, #7ecf5a 0%, #4a9e32 100%);
      color: #fff;
      cursor: pointer;
      box-shadow: 0 8px 28px rgba(0, 0, 0, 0.45);
      transition: transform 0.15s ease, filter 0.15s ease;
    }
    #play-button:hover { filter: brightness(1.08); transform: scale(1.03); }
    #play-button:active { transform: scale(0.98); }
    #play-button:disabled { opacity: 0.65; cursor: wait; transform: none; }
  </style>
</head>
<body class="dark">
<div id="unity-container" class="unity-desktop">
  <canvas id="unity-canvas" tabindex="-1"></canvas>
</div>
<div id="play-cover">
  <button id="play-button" type="button">Play</button>
</div>
<script>
/* Globals + bridge functions Unity jslib calls (must be on window, not inside an IIFE) */
var cloudSaves = 'noData';
var paymentsData = 'none';
var environmentData = 'null';
var playerData = 'noData';
var leaderboard = null;
var ysdk = null;
var myGameInstance = null;
var initGame = false;
var pendingAdClose = false;
var launchStarted = false;
var player = null;

var SAVE_STORAGE_KEY = 'shrek_escape_cloud_saves';

function readSaveBlob(){
  try { return localStorage.getItem(SAVE_STORAGE_KEY); }
  catch (e) { return null; }
}

function writeSaveBlob(jsonData){
  try { localStorage.setItem(SAVE_STORAGE_KEY, jsonData); }
  catch (e) { console.error('Failed to persist save:', e); }
}

(function hydrateCloudSavesFromDisk(){
  var stored = readSaveBlob();
  if (stored) cloudSaves = JSON.stringify([stored]);
})();

function NotAuthorized(){
  return JSON.stringify({playerAuth:'rejected',playerName:'unauthorized',
    playerId:'unauthorized',playerPhoto:'unknown',payingStatus:'unknown'});
}

function InitGame(){
  initGame = true;
  if (pendingAdClose && myGameInstance) {
    myGameInstance.SendMessage('YandexGame', 'CloseFullAd', 'false');
    pendingAdClose = false;
  }
}

/** Instantly dismiss interstitial — never call OpenFullAd (avoids TimerBeforeAdsYG pause overlay). */
function FullAdShow(){
  if (initGame && myGameInstance) {
    myGameInstance.SendMessage('YandexGame', 'CloseFullAd', 'false');
  } else {
    pendingAdClose = true;
  }
  FocusGame();
}

/** Instantly grant reward — no video ad. */
function RewardedShow(id){
  if (myGameInstance) {
    myGameInstance.SendMessage('YandexGame', 'RewardVideo', id || '0');
    myGameInstance.SendMessage('YandexGame', 'CloseVideo');
    FocusGame();
  }
}

function StickyAdActivity(show){}
function StickyAdActivityInternal(show){}
function BuyPayments(id){}
function ConsumePurchases(id){}

function GetPayments(sendback){
  return Promise.resolve('none');
}

function LoadCloud(sendback){
  return new Promise(function(resolve){
    var stored = readSaveBlob();
    var r = stored ? JSON.stringify([stored]) : 'noData';
    cloudSaves = r;
    if (sendback && myGameInstance) {
      myGameInstance.SendMessage('YandexGame', 'SetLoadSaves', r);
    }
    resolve(r);
  });
}

function SaveCloud(jsonData, flush){
  writeSaveBlob(jsonData);
  if (player) {
    try { player.setData({ saves: [jsonData] }, flush); }
    catch (e) { console.error('SaveCloud error:', e); }
  }
}

function RequestingEnvironmentData(sendback){
  return Promise.resolve('null');
}

function InitPlayer(sendback){
  var r = NotAuthorized();
  if (sendback && myGameInstance) myGameInstance.SendMessage('YandexGame', 'SetInitializationSDK', r);
  return Promise.resolve(r);
}
</script>
<script>
/* Minimal offline SDK — no ads; player data persisted in localStorage */
function createOfflinePlayer(){
  return {
    isAuthorized: function(){ return false; },
    getMode: function(){ return 'lite'; },
    getName: function(){ return ''; },
    getUniqueID: function(){ return 'offline-local'; },
    getPhoto: function(){ return ''; },
    getPayingStatus: function(){ return 'unknown'; },
    setData: function(data, flush){
      if (data && data.saves && data.saves[0] !== undefined) {
        writeSaveBlob(data.saves[0]);
      }
      return Promise.resolve();
    },
    getData: function(keys){
      var result = {};
      if (!keys || keys.indexOf('saves') >= 0) {
        var stored = readSaveBlob();
        if (stored) result.saves = [stored];
      }
      return Promise.resolve(result);
    }
  };
}

window.YaGames = { init: function() {
  return Promise.resolve({
    environment: { app:{id:'0'}, i18n:{lang:'en',tld:'com'}, browser:{lang:'en'}, payload:null },
    deviceInfo: {
      type:'desktop',
      isMobile:  function(){ return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent); },
      isDesktop: function(){ return !/iPhone|iPad|iPod|Android/i.test(navigator.userAgent); },
      isTablet:  function(){ return false; },
      isTV:      function(){ return false; }
    },
    screen: { fullscreen:{ status:'off', request:function(){ return Promise.resolve(); }, exit:function(){ return Promise.resolve(); } }},
    adv: {
      showFullscreenAdv: function(o){
        if (o && o.callbacks && o.callbacks.onClose) o.callbacks.onClose(false);
      },
      showRewardedVideo: function(o){
        if (o && o.callbacks) {
          o.callbacks.onRewarded && o.callbacks.onRewarded();
          o.callbacks.onClose && o.callbacks.onClose();
        }
      },
      showBannerAdv:function(){}, hideBannerAdv:function(){},
      getBannerAdvStatus:function(){ return Promise.resolve({stickyAdvIsShowing:false}); }
    },
    auth:{ openAuthDialog:function(){ return Promise.resolve(); } },
    feedback:{ canReview:function(){ return Promise.resolve({value:false,reason:''}); }, requestReview:function(){ return Promise.resolve({feedbackSent:false}); } },
    shortcut:{ canShowPrompt:function(){ return Promise.resolve({canShow:false}); }, showPrompt:function(){ return Promise.resolve({outcome:'rejected'}); } },
    getLeaderboards:function(){ return Promise.resolve({ setLeaderboardScore:function(){ return Promise.resolve(); }, getLeaderboardDescription:function(){ return Promise.reject('no lb'); }, getLeaderboardEntries:function(){ return Promise.reject('no lb'); } }); },
    getPayments:function(){ return Promise.resolve({ getCatalog:function(){ return Promise.resolve([]); }, getPurchases:function(){ return Promise.resolve([]); }, purchase:function(){ return Promise.reject('unavailable'); }, consumePurchase:function(){ return Promise.resolve(); } }); },
    getPlayer: function(){ return Promise.resolve(createOfflinePlayer()); },
    serverTime:function(){ return Date.now(); },
    on:function(){},
    features:{ LoadingAPI:{ready:function(){}}, GameplayAPI:{start:function(){},stop:function(){}} }
  });
}};
</script>
<script>
  var buildUrl = "Build";
  var config = {
    dataUrl:            buildUrl + "/Shrek2.data",
    frameworkUrl:       buildUrl + "/Shrek2.framework.js",
    codeUrl:            buildUrl + "/Shrek2.wasm",
    streamingAssetsUrl: "StreamingAssets",
    companyName:        "DefaultCompany",
    productName:        "DeliviryYandex",
    productVersion:     "0.1.0"
  };

  var canvas = document.querySelector("#unity-canvas");
  var playCover = document.querySelector("#play-cover");
  var playButton = document.querySelector("#play-button");

  function FocusGame(){ window.focus(); canvas.focus(); }
  window.addEventListener('pointerdown', FocusGame);
  window.addEventListener('touchstart', FocusGame);

  async function InitYSDK(){
    try {
      ysdk = await YaGames.init();
      player = await ysdk.getPlayer();
      cloudSaves = await LoadCloud();
      paymentsData = await GetPayments();
      environmentData = await RequestingEnvironmentData();
      playerData = await InitPlayer();
    } catch(e) {
      console.warn('SDK init skipped:', e);
      pendingAdClose = true;
    }
  }

  function signalReadyToUnity(){
    if (!myGameInstance) return;
    myGameInstance.SendMessage('YandexGame', 'SetInitializationSDK', NotAuthorized());
    if (ysdk && ysdk.features && ysdk.features.LoadingAPI) {
      ysdk.features.LoadingAPI.ready();
    }
  }

  async function detectPartCount(baseUrl){
    for (var i = 0; i < 32; i++) {
      var response = await fetch(baseUrl + '.part' + i, { method: 'HEAD' });
      if (!response.ok) return i;
    }
    return 32;
  }

  async function fetchParts(baseUrl, partCount){
    var parts = [];
    for (var i = 0; i < partCount; i++) {
      var response = await fetch(baseUrl + '.part' + i);
      if (!response.ok) throw new Error('part' + i + ': HTTP ' + response.status);
      parts.push(new Uint8Array(await response.arrayBuffer()));
    }
    var total = parts.reduce(function(sum, part){ return sum + part.length; }, 0);
    var merged = new Uint8Array(total);
    var offset = 0;
    for (var j = 0; j < parts.length; j++) {
      merged.set(parts[j], offset);
      offset += parts[j].length;
    }
    return merged;
  }

  function brotliBlobUrl(uint8, filename){
    var blob = new Blob([uint8], { type: 'application/octet-stream' });
    return URL.createObjectURL(blob) + '#' + encodeURIComponent(filename);
  }

  async function resolveUnityConfig(){
    var unityConfig = Object.assign({}, config);
    try {
      var dataPartCount = await detectPartCount(buildUrl + '/Shrek2.data.br');
      if (dataPartCount > 0) {
        var dataBytes = await fetchParts(buildUrl + '/Shrek2.data.br', dataPartCount);
        unityConfig.dataUrl = brotliBlobUrl(dataBytes, 'Shrek2.data.br');
      }
      var wasmPartCount = await detectPartCount(buildUrl + '/Shrek2.wasm.br');
      if (wasmPartCount > 0) {
        var wasmBytes = await fetchParts(buildUrl + '/Shrek2.wasm.br', wasmPartCount);
        unityConfig.codeUrl = brotliBlobUrl(wasmBytes, 'Shrek2.wasm.br');
      }
    } catch (error) {
      console.warn('Chunked asset load failed, using direct URLs:', error);
    }
    return unityConfig;
  }

  async function launchUnity(){
    if (!window.createUnityInstance) {
      console.error('Unity loader missing');
      playButton.disabled = false;
      playButton.textContent = 'Play';
      return;
    }

    var unityConfig = await resolveUnityConfig();
    createUnityInstance(canvas, unityConfig, function(){}).then(function(inst){
      myGameInstance = inst;
      playCover.style.display = 'none';
      InitGame();
      signalReadyToUnity();
      FocusGame();
    }).catch(function(msg){
      console.error(msg);
      launchStarted = false;
      playButton.disabled = false;
      playButton.textContent = 'Play';
      alert('Failed to start game: ' + msg);
    });
  }

  function loadUnityLoader(){
    return new Promise(function(resolve, reject){
      if (window.createUnityInstance) { resolve(); return; }
      var script = document.createElement('script');
      script.src = buildUrl + '/Shrek2.loader.js';
      script.onload = function(){ resolve(); };
      script.onerror = function(){ reject(new Error('Failed to load Unity loader')); };
      document.body.appendChild(script);
    });
  }

  async function onPlayClick(){
    if (launchStarted) return;
    launchStarted = true;
    playButton.disabled = true;
    playButton.textContent = 'Loading…';

    try {
      await InitYSDK();
      await loadUnityLoader();
      await launchUnity();
    } catch (error) {
      console.error(error);
      launchStarted = false;
      playButton.disabled = false;
      playButton.textContent = 'Play';
      alert('Failed to load game assets.');
    }
  }

  playButton.addEventListener('click', onPlayClick);
</script>
</body>
</html>`;
}
