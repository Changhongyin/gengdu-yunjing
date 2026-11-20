App({
  globalData: { panoramaUrl: 'https://www.720yun.com/vr/750jezhm5k0' },
  onLaunch() {
    require('./utils/asset-source').init();
    const store = require('./utils/store');
    store.initialize();
  }
});
