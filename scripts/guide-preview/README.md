# Guide preview harness

A development tool for looking at the guide entry, cinematic, and chat in a
desktop browser when WeChat DevTools is not available. It is in `scripts/`,
which `project.config.json` excludes from the mini-program package.

It is NOT the WeChat runtime. It loads this project's real WXML, WXSS, and JS
and interprets them with a small runtime (`runtime.js`): template rendering,
`setData`, components, the custom tab bar, page stack, and shims for the `wx`
APIs and built-in components the project uses.

## Run

    node scripts/guide-preview/server.cjs 4173
    # open http://127.0.0.1:4173/ in Chrome or Edge at a phone-sized window
    # optional start page: http://127.0.0.1:4173/?page=pages/shop/index

Capture screenshots and the recording (needs `puppeteer-core`, Microsoft Edge,
and an ffmpeg executable; all optional paths are environment variables):

    set PUPPETEER_CORE=<folder of puppeteer-core>
    set HARNESS_KAI_FONT=<folder of the lxgw-wenkai-webfont npm package>   (optional)
    set FFMPEG=<path to ffmpeg.exe>                                         (optional)
    node scripts/guide-preview/capture.cjs ..\evidence

Companion evidence (floating character, gestures, proactive introductions) uses
the same environment variables and sends no provider request:

    node scripts/guide-preview/capture-pet.cjs ..\Claude_Pet_Handoff\evidence

## Known differences from WeChat

- Touch events are synthesized from one mouse pointer (touchstart, touchmove,
  touchend, touchcancel with a single touch). Multi-touch, system gesture
  conflicts and real touch slop cannot be judged here.
- `wx.getWindowInfo` reports the iframe size, a 91 px status and navigation
  area and a 34 px bottom safe area. `wx.vibrateShort` only writes a log entry.
- `canvas type="webgl"` is not emulated: the camphor 360 viewer shows an empty
  dark stage and logs one `fields is not a function` page error.

- Layout engine is Chromium, not the WeChat webview on iOS or Android.
- `rpx` is converted to `vw`; `env(safe-area-inset-bottom)` is a fixed 34 px.
- The status bar, navigation bar, capsule button, home indicator, and keyboard
  are drawn by the harness. The keyboard is a labeled picture that reports a
  300 px height; it is not a system keyboard.
- `swiper` shows one item without gestures or autoplay; `movable-view`,
  `canvas`, `web-view` and `picker` are plain boxes.
- `page-container` is emulated only as "a shown container swallows one back"
  (it fires beforeleave, leave and afterleave in one go).
- `page-meta` is emulated only for `page-style="overflow:hidden"`, which locks
  the page scroller. Real scroll-through, `catchtouchmove` and touch behavior
  cannot be judged here.
- Page navigation is instant (no native push animation).
- `wx.request` is implemented with `fetch` through `/__proxy` on the local
  server, which forwards only to the configured provider base URL and adds the
  key from `../api-config/.env.local` on the server side. Request-domain
  checks of the real platform do not exist here.
- KaiTi/STKaiti may be missing on the machine. `HARNESS_KAI_FONT` maps the
  STKaiti family to the open-source LXGW WenKai webfont for the harness only.
  Real devices use their own system fonts.
- Component style isolation is not enforced (styles are global, page styles are
  scoped by route).

`window.__harness` in the webview frame exposes helpers used by `capture.cjs`:
`back()`, `appHide()`, `appShow()`, `agent()`, `net` (`proxy`, `offline`, `hang`).
