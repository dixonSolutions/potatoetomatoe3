/**
 * Offline SDK stubs — no ads, no remote loaders.
 */

/** Minimal PokiSDK stub for offline OpenFL / HTML5 builds. */
export function buildPokiOfflineStubScript(): string {
	return `(function(){
  var resolved = function(v){ return Promise.resolve(v); };
  var noop = function(){};
  window.PokiSDK = {
    init: function(){ return resolved(); },
    gameLoadingStart: noop,
    gameLoadingProgress: noop,
    gameLoadingFinished: noop,
    gameplayStart: noop,
    gameplayStop: noop,
    happyTime: noop,
    commercialBreak: function(){ return resolved(); },
    rewardedBreak: function(){ return resolved(false); },
    isAdBlocked: function(){ return false; }
  };
})();`;
}

/**
 * Minimal YaGames / Yandex Games stub (ad-free) for Unity WebGL builds.
 * Instantly closes interstitials and grants rewarded callbacks.
 */
export function buildYandexOfflineStubScript(): string {
	return `(function(){
  function createOfflinePlayer(){
    return {
      isAuthorized: function(){ return false; },
      getMode: function(){ return 'lite'; },
      getName: function(){ return ''; },
      getUniqueID: function(){ return 'offline-local'; },
      getPhoto: function(){ return ''; },
      getPayingStatus: function(){ return 'unknown'; },
      setData: function(){ return Promise.resolve(); },
      getData: function(){ return Promise.resolve({}); }
    };
  }
  window.YaGames = { init: function() {
    return Promise.resolve({
      environment: { app:{id:'0'}, i18n:{lang:'en',tld:'com'}, browser:{lang:'en'}, payload:null },
      deviceInfo: {
        type:'desktop',
        isMobile: function(){ return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent); },
        isDesktop: function(){ return !/iPhone|iPad|iPod|Android/i.test(navigator.userAgent); },
        isTablet: function(){ return false; },
        isTV: function(){ return false; }
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
  window.FullAdShow = function(){};
  window.RewardedShow = function(id){
    if (window.myGameInstance) {
      window.myGameInstance.SendMessage('YandexGame', 'RewardVideo', id || '0');
      window.myGameInstance.SendMessage('YandexGame', 'CloseVideo');
    }
  };
  window.StickyAdActivity = function(){};
})();`;
}

/** Generic commercial SDK no-ops when neither Poki nor Yandex is detected. */
export function buildGenericAdStubScript(): string {
	return `(function(){
  var resolved = function(v){ return Promise.resolve(v); };
  var noop = function(){};
  window.__ptAdFree = true;
  if (!window.PokiSDK) {
    window.PokiSDK = {
      init: function(){ return resolved(); },
      commercialBreak: function(){ return resolved(); },
      rewardedBreak: function(){ return resolved(false); },
      gameLoadingStart: noop, gameLoadingFinished: noop,
      gameplayStart: noop, gameplayStop: noop, happyTime: noop
    };
  }
})();`;
}
