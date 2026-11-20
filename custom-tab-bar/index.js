// Custom tab bar. Keeps the four original destinations and adds the center
// guide action, which opens an in-page layer instead of navigating.
const entry = require('../utils/guide-entry');
const pet = require('../utils/pet-controller');
const tabs = [
  { path: 'pages/guide/index', text: '线上寻樟' },
  { path: 'pages/village/index', text: '古村漫行' },
  { path: 'pages/shop/index', text: '乡味好物' },
  { path: 'pages/profile/index', text: '我的' }
];
Component({
  data: { selected: 0, tabs, sunk: false },
  lifetimes: {
    attached() {
      const index = entry.tabIndex(entry.currentPage());
      if (index >= 0 && index !== this.data.selected) this.setData({ selected: index });
    }
  },
  methods: {
    agent() { return this.selectComponent('#guide'); },
    switchTab(e) {
      const index = Number(e.currentTarget.dataset.index);
      const agent = this.agent();
      if (agent && agent.isOpen()) return;
      if (index === this.data.selected || !tabs[index]) return;
      wx.switchTab({ url: '/' + tabs[index].path });
    },
    // Center button: the layer opens with whatever scenic context the current page has
    // (the village on the two tourism tabs, none on shop and profile).
    openGuide() { this.openGuideWith({ context: pet.chatContext(entry.currentPage()) }); },
    // Also used by the floating companion on the tourism tabs. Returns true when the layer opened.
    openGuideWith(options) {
      const agent = this.agent();
      if (!agent) return false;
      this._guidePage = entry.currentPage();
      return agent.open(options) === true;
    },
    onPhase(e) {
      const sunk = !['idle', 'leaving'].includes(e.detail.phase);
      if (sunk !== this.data.sunk) this.setData({ sunk });
      pet.chatPhase(this._guidePage || entry.currentPage(), e.detail.phase);
    },
    pageShow() { const agent = this.agent(); if (agent) agent.pageShow(); },
    pageHide() { const agent = this.agent(); if (agent) agent.pageHide(); }
  }
});
