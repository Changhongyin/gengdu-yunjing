// Glue between pages and the guide layer (custom tab bar or companion host).
const TAB_ROUTES = ['pages/guide/index', 'pages/village/index', 'pages/shop/index', 'pages/profile/index'];
const TAB_TITLES = ['耕读云镜 · 樟影书声', '古村漫行', '乡味好物', '我的耕读日常'];
// Static titles of the non-tab pages that can host the guide layer (mirrors each
// page's index.json; scripts/check-pet.cjs keeps them in sync). Pages whose title
// is set at runtime store it in page.navTitle.
const PAGE_TITLES = {
  'pages/panorama/index': '线上寻樟 · 全景漫游',
  'pages/place/index': '村落档案',
  'pages/visit/index': '古村慢行 · 路线演示',
  'pages/cards/index': '樟影书声卡集',
  'pages/postcard/index': '我的寻樟明信片',
  'pages/gallery/index': '实景影册'
};
function currentPage() {
  const pages = getCurrentPages();
  return pages.length ? pages[pages.length - 1] : null;
}
const routeOf = page => String(page && (page.route || page.__route__) || '').replace(/^\//, '');
function tabIndex(page) {
  return TAB_ROUTES.indexOf(routeOf(page));
}
function bar(page) {
  return page && typeof page.getTabBar === 'function' ? page.getTabBar() : null;
}
// Call from each tab page's onShow: keeps the active tab correct.
function show(page, index) {
  const tabBar = bar(page);
  if (!tabBar) return;
  if (tabBar.data.selected !== index) tabBar.setData({ selected: index });
  if (typeof tabBar.pageShow === 'function') tabBar.pageShow();
}
// Call from each tab page's onHide: lets the guide layer cancel timers and requests.
function hide(page) {
  const tabBar = bar(page);
  if (tabBar && typeof tabBar.pageHide === 'function') tabBar.pageHide();
}
// motion: 'guide-out' (content recedes), 'guide-in' (content returns) or ''.
// While the layer is open the page behind is locked through <page-meta page-style>
// (the documented way to stop scroll-through), so its scroll position is kept.
// lock === false leaves the page scrollable (guide-config lockPageScroll: false).
// Works on every page that declares guideMotion in its data and binds it in its template.
function setMotion(motion, lock, target) {
  const page = target || currentPage();
  if (!page || typeof page.setData !== 'function' || !page.data || page.data.guideMotion === undefined) return null;
  const guideLock = motion === 'guide-out' && lock !== false ? 'overflow:hidden;' : '';
  const patch = {};
  if (page.data.guideMotion !== motion) patch.guideMotion = motion;
  if ((page.data.guideLock || '') !== guideLock) patch.guideLock = guideLock;
  if (Object.keys(patch).length) page.setData(patch);
  return page;
}
function setTitle(title) {
  if (typeof wx.setNavigationBarTitle === 'function') wx.setNavigationBarTitle({ title, fail() {} });
}
// The real title of a page: runtime title, tab title or the static page title.
function titleOf(page) {
  if (!page) return '';
  if (page.navTitle) return page.navTitle;
  const index = tabIndex(page);
  return index >= 0 ? TAB_TITLES[index] : PAGE_TITLES[routeOf(page)] || '';
}
function restoreTitle(target) {
  const title = titleOf(target || currentPage());
  if (title) setTitle(title);
}
module.exports = { TAB_ROUTES, TAB_TITLES, PAGE_TITLES, currentPage, routeOf, tabIndex, show, hide, setMotion, setTitle, titleOf, restoreTitle };
