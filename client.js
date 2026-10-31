/**
 * Client half of the music player bundle.
 *
 * Registers one entry in `shell.overlay` (the frame-wide floating layer) that
 * renders a glass vinyl disc. Geometry, drag and the circle -> bar expansion
 * all live in this component; the playback engine is not wired yet, so the
 * transport buttons only drive local state.
 */
window.__ModuleLoader__.load({
  id: 'dsh-music-player',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useRef } = React

    // ------------------------------------------------------------------ layout
    const MARGIN = 14 // min distance from the viewport edges
    const GAP = 10 // gap between the bar and the gear below it
    const GEAR = 44 // gear circle diameter
    const POS_KEY = 'dsh-music-player:position:v1'
    // Shown in the settings-panel footer so the running build is verifiable at a
    // glance (the page keeps serving a cached module until it is reloaded).
    const BUILD = 'v0.1.62'
    const API_BASE = '/dsh-music'
    const LINK_KEY = 'dsh-music-player:link:v1'
    const TRACKS_KEY = 'dsh-music-player:tracks:v1'
    const VOLUME_KEY = 'dsh-music-player:volume:v1'
    const MODE_KEY = 'dsh-music-player:mode:v1'
    const DEFAULT_LINK = 'https://www.bilibili.com/medialist/detail/ml4345449283'
    // Transport sizes mirror the CSS: the bar is sized around them, so the
    // controls stay close together instead of spreading over three thirds.
    const BTN_SIDE = 34
    const BTN_MAIN = 51
    const CONTROL_GAP = 17 // half the previous edge-to-edge gap (33.5 -> 17)
    const BAR_PADDING = 21 // side padding, keeps the side buttons near the caps
    const BAR_NATURAL = BTN_SIDE * 2 + BTN_MAIN + CONTROL_GAP * 2 + BAR_PADDING * 2 // 195
    // Groove rings of the disc, in viewBox units (the disc is a 100x100 circle).
    const GROOVE_RADII = [46, 42.5, 39, 35.5, 32, 28.5, 25, 21.5]

    const COPY = {
      zh: {
        panelTitle: '音乐播放器',
        panelSub: '黑胶 · B 站收藏歌单',
        searchPlaceholder: '搜索想听的歌…',
        searchHint: '回车搜索 B 站视频，点结果立即播放；这首放完会自动回到歌单。',
        playlistPlaceholder: '粘贴 B 站收藏歌单链接…',
        login: '登录 B 站',
        repeat: '单曲循环',
        shuffle: '随机播放',
        soon: '即将上线',
        preview: 'B 站音源已接入',
        account: 'B 站账号',
        sessPlaceholder: '粘贴 SESSDATA（可选，音质更高）',
        loggedInAs: '已登录',
        logout: '退出',
        playlistSection: '歌单',
        playlistHelp: '怎么拿到歌单链接',
        helpStep1: '登录电脑网页版 B 站',
        helpStep2: '把收藏歌单设置为公开',
        helpStep3: '转发歌单到动态',
        helpStep4: '点击动态中的歌单并跳转',
        helpStep5: '复制歌单链接',
        helpExample: '例：https://www.bilibili.com/medialist/detail/...',
        helpStep6: '在这里贴上后载入即可使用',
        load: '载入',
        loadMore: '加载更多',
        noPlaylist: '粘贴收藏夹链接后回车',
        searchSection: '搜索',
        tempBadge: '临时',
        playFailed: '播放失败',
        mute: '静音',
        unmute: '取消静音',
        buffering: '缓冲中…',
        loadingPlaylist: '载入歌单…',
        searching: '搜索中…',
        signingIn: '登录中…',
        loadFailed: '歌单载入失败',
        searchFailed: '搜索失败',
        noResults: '没有找到结果',
        loginFailed: '登录失败',
        signOutFailed: '退出失败',
        searchNoted: '已记录「{q}」，音乐功能待接入',
        playlistNoted: '歌单链接已记录，音乐功能待接入',
        loginNoted: 'B 站登录功能待接入',
        notReady: '音乐功能待接入',
        close: '关闭',
        prev: '上一首',
        next: '下一首',
        play: '播放',
        pause: '暂停',
        gear: '设置面板',
        expand: '展开播放器',
      },
      en: {
        panelTitle: 'Music Player',
        panelSub: 'Vinyl · Bilibili playlist',
        searchPlaceholder: 'Search for a song…',
        searchHint: 'Enter searches Bilibili; clicking a result plays it right away and the playlist resumes afterwards.',
        playlistPlaceholder: 'Paste a Bilibili playlist link…',
        login: 'Sign in to Bilibili',
        repeat: 'Repeat one',
        shuffle: 'Shuffle',
        soon: 'Soon',
        preview: 'Bilibili source connected',
        account: 'Bilibili account',
        sessPlaceholder: 'Paste SESSDATA (optional, better quality)',
        loggedInAs: 'Signed in as',
        logout: 'Sign out',
        playlistSection: 'Playlist',
        playlistHelp: 'How to get a playlist link',
        helpStep1: 'Sign in to bilibili.com on desktop',
        helpStep2: 'Set the favorite folder to public',
        helpStep3: 'Share it to your feed',
        helpStep4: 'Open the playlist from the feed',
        helpStep5: 'Copy the playlist link',
        helpExample: 'e.g. https://www.bilibili.com/medialist/detail/...',
        helpStep6: 'Paste it here, press Load and play',
        load: 'Load',
        loadMore: 'Load more',
        noPlaylist: 'Paste a favorite-folder link and press Enter',
        searchSection: 'Search',
        tempBadge: 'temp',
        playFailed: 'Playback failed',
        mute: 'Mute',
        unmute: 'Unmute',
        buffering: 'Buffering…',
        loadingPlaylist: 'Loading playlist…',
        searching: 'Searching…',
        signingIn: 'Signing in…',
        loadFailed: 'Playlist failed',
        searchFailed: 'Search failed',
        noResults: 'No results',
        loginFailed: 'Sign-in failed',
        signOutFailed: 'Sign-out failed',
        searchNoted: 'Saved "{q}" — music features are coming soon',
        playlistNoted: 'Playlist link saved — music features are coming soon',
        loginNoted: 'Bilibili sign-in is coming soon',
        notReady: 'Music features coming soon',
        close: 'Close',
        prev: 'Previous track',
        next: 'Next track',
        play: 'Play',
        pause: 'Pause',
        gear: 'Settings panel',
        expand: 'Expand player',
      },
    }

    function clamp(value, min, max) {
      return Math.min(Math.max(value, min), max)
    }

    function format(template, vars) {
      return String(template).replace(/\{(\w+)\}/g, (match, key) =>
        Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : match,
      )
    }

    function readPosition() {
      try {
        const raw = window.localStorage.getItem(POS_KEY)
        if (!raw) return null
        const parsed = JSON.parse(raw)
        if (!parsed || typeof parsed.x !== 'number' || typeof parsed.y !== 'number') return null
        return { x: parsed.x, y: parsed.y }
      } catch (error) {
        return null
      }
    }

    function writePosition(position) {
      try {
        window.localStorage.setItem(POS_KEY, JSON.stringify(position))
      } catch (error) {
        /* storage is best effort */
      }
    }

    function readStore(key) {
      try {
        return window.localStorage.getItem(key)
      } catch (error) {
        return null
      }
    }

    function writeStore(key, value) {
      try {
        window.localStorage.setItem(key, value)
      } catch (error) {
        /* storage is best effort */
      }
    }

    function formatTime(seconds) {
      const total = Math.max(0, Math.round(Number(seconds) || 0))
      const minutes = Math.floor(total / 60)
      const rest = total % 60
      return minutes + ':' + (rest < 10 ? '0' : '') + rest
    }

    function detectLang(ctx) {
      try {
        const locale = ctx.get('locale')
        const snapshot = locale && typeof locale.getLocale === 'function' ? locale.getLocale() : null
        const id = String(
          (snapshot && (snapshot.id || snapshot.locale || snapshot.current || snapshot.active)) || '',
        ).toLowerCase()
        if (id) return id.indexOf('zh') === 0 ? 'zh' : 'en'
      } catch (error) {
        /* fall through to the document language */
      }
      const htmlLang = String((document.documentElement && document.documentElement.lang) || '').toLowerCase()
      return htmlLang.indexOf('zh') === 0 ? 'zh' : 'en'
    }

    // ------------------------------------------------------------------- icons
    function svg(size, children) {
      return h(
        'svg',
        {
          viewBox: '0 0 24 24',
          width: size,
          height: size,
          'aria-hidden': 'true',
          focusable: 'false',
          style: { display: 'block' },
        },
        children,
      )
    }

    function iconPrev(size) {
      return svg(size, [
        h('path', {
          key: 'bar',
          d: 'M7.4 5.8v12.4',
          stroke: 'currentColor',
          strokeWidth: 2,
          strokeLinecap: 'round',
          fill: 'none',
        }),
        h('path', {
          key: 'tri',
          d: 'M18 6.4 10.2 12 18 17.6z',
          fill: 'currentColor',
          stroke: 'currentColor',
          strokeWidth: 1.2,
          strokeLinejoin: 'round',
        }),
      ])
    }

    function iconNext(size) {
      return svg(size, [
        h('path', {
          key: 'bar',
          d: 'M16.6 5.8v12.4',
          stroke: 'currentColor',
          strokeWidth: 2,
          strokeLinecap: 'round',
          fill: 'none',
        }),
        h('path', {
          key: 'tri',
          d: 'M6 6.4 13.8 12 6 17.6z',
          fill: 'currentColor',
          stroke: 'currentColor',
          strokeWidth: 1.2,
          strokeLinejoin: 'round',
        }),
      ])
    }

    function iconPlay(size) {
      return svg(size, [
        h('path', {
          key: 'tri',
          d: 'M8.8 6.2 18 12 8.8 17.8z',
          fill: 'currentColor',
          stroke: 'currentColor',
          strokeWidth: 1.4,
          strokeLinejoin: 'round',
        }),
      ])
    }

    function iconPause(size) {
      return svg(size, [
        h('rect', { key: 'a', x: 8.1, y: 6.1, width: 3, height: 11.8, rx: 1.5, fill: 'currentColor' }),
        h('rect', { key: 'b', x: 12.9, y: 6.1, width: 3, height: 11.8, rx: 1.5, fill: 'currentColor' }),
      ])
    }

    function iconGear(size) {
      const teeth = []
      for (let index = 0; index < 8; index += 1) {
        teeth.push(
          h('line', {
            key: 'tooth' + index,
            x1: 12,
            y1: 3.9,
            x2: 12,
            y2: 6.4,
            stroke: 'currentColor',
            strokeWidth: 2,
            strokeLinecap: 'round',
            transform: 'rotate(' + index * 45 + ' 12 12)',
          }),
        )
      }
      return svg(size, [
        h('circle', {
          key: 'ring',
          cx: 12,
          cy: 12,
          r: 5.4,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.7,
        }),
      ].concat(teeth))
    }

    function iconVolume(level) {
      const waves = []
      if (level > 0.02) {
        waves.push(
          h('path', {
            key: 'w1',
            d: 'M15.4 9.4a3.8 3.8 0 0 1 0 5.2',
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 1.6,
            strokeLinecap: 'round',
          }),
        )
      }
      if (level > 0.5) {
        waves.push(
          h('path', {
            key: 'w2',
            d: 'M17.8 6.9a7.2 7.2 0 0 1 0 10.2',
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 1.6,
            strokeLinecap: 'round',
          }),
        )
      }
      return svg(14, [
        h('path', {
          key: 'spk',
          d: 'M4.4 9.7h2.3L10.5 6.5v11L6.7 14.3H4.4z',
          fill: 'currentColor',
          strokeLinejoin: 'round',
        }),
      ].concat(waves))
    }

    function iconClose(size) {
      return svg(size, [
        h('path', {
          key: 'a',
          d: 'M6.8 6.8 17.2 17.2',
          stroke: 'currentColor',
          strokeWidth: 1.9,
          strokeLinecap: 'round',
          fill: 'none',
        }),
        h('path', {
          key: 'b',
          d: 'M17.2 6.8 6.8 17.2',
          stroke: 'currentColor',
          strokeWidth: 1.9,
          strokeLinecap: 'round',
          fill: 'none',
        }),
      ])
    }

    function iconSearch(size) {
      return svg(size, [
        h('circle', {
          key: 'c',
          cx: 10.8,
          cy: 10.8,
          r: 5.9,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.8,
        }),
        h('path', {
          key: 'l',
          d: 'M15.2 15.2 19.4 19.4',
          stroke: 'currentColor',
          strokeWidth: 1.8,
          strokeLinecap: 'round',
          fill: 'none',
        }),
      ])
    }

    function iconLink(size) {
      return svg(size, [
        h('path', {
          key: 'a',
          d: 'M10.4 13.6a3.5 3.5 0 0 0 5 0l2.2-2.2a3.5 3.5 0 0 0-5-5l-1.1 1.1',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinecap: 'round',
        }),
        h('path', {
          key: 'b',
          d: 'M13.6 10.4a3.5 3.5 0 0 0-5 0l-2.2 2.2a3.5 3.5 0 0 0 5 5l1.1-1.1',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinecap: 'round',
        }),
      ])
    }

    function iconUser(size) {
      return svg(size, [
        h('circle', {
          key: 'head',
          cx: 12,
          cy: 8.6,
          r: 3.4,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.7,
        }),
        h('path', {
          key: 'body',
          d: 'M5.6 19c.7-3.2 3.2-5 6.4-5s5.7 1.8 6.4 5',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinecap: 'round',
        }),
      ])
    }

    function iconRepeat(size) {
      // Bold loop + a drawn "1": a text glyph this small turned to mush.
      return svg(size, [
        h('circle', {
          key: 'ring',
          cx: 12,
          cy: 12.4,
          r: 8.2,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 2,
        }),
        h('path', {
          key: 'arrow',
          d: 'M12.2 2.6 15.1 5.4 12.2 8.2',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 2,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
        h('path', {
          key: 'one',
          d: 'M10.4 10.2 12.9 8.8 V15.6',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 2.3,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
        h('path', {
          key: 'oneBase',
          d: 'M10.1 15.7 H15',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 2.1,
          strokeLinecap: 'round',
        }),
      ])
    }

    function iconShuffle(size) {
      return svg(size, [
        h('path', {
          key: 'a',
          d: 'M4 7h3.1l9.8 10H20',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
        h('path', {
          key: 'b',
          d: 'M4 17h3.1l9.8-10H20',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
        h('path', {
          key: 'c1',
          d: 'M17.5 4.6 20.2 7l-2.7 2.4',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
        h('path', {
          key: 'c2',
          d: 'M17.5 14.6 20.2 17l-2.7 2.4',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
      ])
    }

    // ------------------------------------------------------------------- styles
    const CSS = `
.dshmp-root{position:fixed;inset:0;pointer-events:none;z-index:60;font-family:inherit;color:var(--dsw-alias-label-primary);--dshmp-beat:.5s}
.dshmp-root *,.dshmp-root *::before,.dshmp-root *::after{box-sizing:border-box}
.dshmp-stage{position:absolute;left:0;top:0;pointer-events:auto;touch-action:none;cursor:grab;user-select:none;-webkit-user-select:none;
  transition:width .46s cubic-bezier(.22,.68,.24,1),transform .46s cubic-bezier(.22,.68,.24,1)}
.dshmp-stage.dshmp-circle{cursor:pointer}
.dshmp-stage.dshmp-dragging{transition:none;cursor:grabbing}
.dshmp-stage:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:3px;border-radius:999px}
.dshmp-glass{position:absolute;inset:0;border-radius:999px;overflow:hidden;
  background:
    linear-gradient(158deg,rgba(255,255,255,.024) 0%,rgba(255,255,255,.004) 44%,rgba(255,255,255,.003) 70%,rgba(255,255,255,.012) 100%),
    rgba(18,20,26,.033);
  background:
    linear-gradient(158deg,rgba(255,255,255,.024) 0%,rgba(255,255,255,.004) 44%,rgba(255,255,255,.003) 70%,rgba(255,255,255,.012) 100%),
    color-mix(in srgb,var(--dsw-alias-bg-layer-1) 4%,transparent);
  -webkit-backdrop-filter:blur(4px) saturate(150%);backdrop-filter:blur(4px) saturate(150%);
  border:1px solid rgba(255,255,255,.32);
  box-shadow:0 12px 34px rgba(0,0,0,.24),0 2px 8px rgba(0,0,0,.12),
    inset 0 1px 0 rgba(255,255,255,.36),inset 0 -14px 28px rgba(255,255,255,.05)}
.dshmp-vinyl{position:absolute;left:50%;top:50%;z-index:1;display:block;overflow:visible;pointer-events:none;opacity:.8;
  transform:translate(-50%,-50%);filter:drop-shadow(0 3px 10px rgba(0,0,0,.42));
  transition:opacity .26s ease,transform .46s cubic-bezier(.22,.68,.24,1)}
.dshmp-bar .dshmp-vinyl{opacity:0;transform:translate(-50%,-96%) scale(.84)}
.dshmp-disc-spin{transform-box:fill-box;transform-origin:center;animation:dshmp-spin 4.8s linear infinite}
.dshmp-paused .dshmp-disc-spin{animation-play-state:paused}
.dshmp-controls{position:absolute;inset:0;z-index:2;display:flex;align-items:center;justify-content:center;gap:17px;
  opacity:0;pointer-events:none;transition:opacity .16s ease}
.dshmp-bar .dshmp-controls{opacity:1;pointer-events:auto;transition:opacity .24s ease .22s}
.dshmp-btn{display:grid;place-items:center;border:0;padding:0;margin:0;cursor:pointer;border-radius:50%;
  color:#fefaf2;
  background:rgba(150,158,172,.55);
  -webkit-backdrop-filter:blur(9px) saturate(150%);backdrop-filter:blur(9px) saturate(150%);
  box-shadow:inset 0 0 0 1px rgba(255,255,255,.30);
  transition:background .16s ease,transform .14s ease,box-shadow .16s ease}
.dshmp-btn:hover{background:rgba(158,166,181,.66);box-shadow:inset 0 0 0 1px rgba(255,255,255,.44)}
.dshmp-btn:active{transform:scale(.9)}
.dshmp-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.dshmp-btn>svg{opacity:.8}
.dshmp-btn-main{width:51px;height:51px}
.dshmp-btn-side{width:34px;height:34px;background:rgba(150,158,172,.55)}
.dshmp-btn-side:hover{background:rgba(158,166,181,.66)}
.dshmp-gear-anchor{position:absolute;left:0;top:0;pointer-events:none}
/* Buttons clip their own content in Chromium and overflow cannot lift that, so
   every border/glow that may leave the box lives outside the button. The body of
   each small circle is an SVG circle too: nothing is painted from a CSS box, so
   no rounded-square edge can appear. */
.dshmp-gear{display:grid;place-items:center;border:0;padding:0;margin:0;border-radius:50%;cursor:pointer;
  color:#fefaf2;background:none;
  opacity:0;transform:scale(.55);pointer-events:none;
  transition:opacity .24s ease,transform .34s cubic-bezier(.22,.68,.24,1)}
.dshmp-gear::before{content:'';position:absolute;inset:0;border-radius:50%;pointer-events:none;
  background:rgba(150,158,172,.55);
  -webkit-backdrop-filter:blur(9px) saturate(150%);backdrop-filter:blur(9px) saturate(150%);
  transition:background .16s ease}
.dshmp-gear:hover::before{background:rgba(158,166,181,.66)}
.dshmp-gear.dshmp-visible{opacity:1;transform:scale(1);pointer-events:auto}
.dshmp-gear:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.dshmp-gear>svg{z-index:1}
/* The gear glyph stays at the same full white as the transport icons; only its
   disc is grey. */
.dshmp-gear>svg{opacity:.8;transition:transform .38s cubic-bezier(.34,1.4,.4,1)}
.dshmp-gear.dshmp-open>svg{transform:rotate(90deg)}
/* One dot = a positioned wrapper plus a button inside it. Body, border and the
   running light are all SVG circles on the wrapper. */
.dshmp-mode-wrap{position:absolute;top:50%;width:38px;height:38px;margin-top:-19px;
  opacity:0;pointer-events:none;
  transition:opacity .18s ease,transform .26s cubic-bezier(.22,.68,.24,1)}
.dshmp-mode-wrap-left{right:calc(100% + 9px);transform:translateX(12px) scale(.88)}
.dshmp-mode-wrap-right{left:calc(100% + 9px);transform:translateX(-12px) scale(.88)}
.dshmp-mode-wrap.dshmp-mode-on{opacity:1;pointer-events:auto;transform:translateX(0) scale(1)}
.dshmp-mode::before{content:'';position:absolute;inset:0;border-radius:50%;pointer-events:none;
  background:rgba(150,158,172,.55);
  -webkit-backdrop-filter:blur(9px) saturate(150%);backdrop-filter:blur(9px) saturate(150%);
  transition:background .16s ease}
.dshmp-mode-wrap:hover .dshmp-mode::before{background:rgba(158,166,181,.66)}
.dshmp-mode{position:absolute;inset:0;width:100%;height:100%;display:grid;place-items:center;
  border:0;padding:0;margin:0;border-radius:50%;background:none;cursor:pointer;
  color:#fefaf2;transition:color .16s ease}
/* The dot body is an SVG circle (fill driven by CSS so hover still works). */
.dshmp-mode-wrap.dshmp-selected .dshmp-mode{color:#fefaf2}
.dshmp-mode:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.dshmp-mode>svg{opacity:.8;z-index:1;transition:opacity .16s ease}
/* Border, body and running light are SVG circles: nothing comes from a CSS box. */
.dshmp-ring{position:absolute;inset:-3px;width:calc(100% + 6px);height:calc(100% + 6px);overflow:visible;pointer-events:none;
  filter:drop-shadow(0 3px 8px rgba(0,0,0,.34))}
.dshmp-gear-ring{position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none;filter:drop-shadow(0 3px 8px rgba(0,0,0,.34))}
/* Repeat-one: a ripple expanding from the glyph centre. */
.dshmp-ripple{transform-box:fill-box;transform-origin:center;
  animation:dshmp-ripple calc(var(--dshmp-beat) * 2) ease-out infinite}
@keyframes dshmp-ripple{
  0%{opacity:0;transform:scale(.45)}
  18%{opacity:.55;transform:scale(.85)}
  70%{opacity:0;transform:scale(1.55)}
  100%{opacity:0;transform:scale(1.55)}}
/* Repeat-one: the glyph itself breathes with the ripple. */
.dshmp-mode-repeat.dshmp-selected .dshmp-mode>svg{
  animation:dshmp-icon-pulse var(--dshmp-beat) ease-out infinite}
@keyframes dshmp-icon-pulse{
  0%,100%{transform:scale(1)}
  38%{transform:scale(1.12)}
  62%{transform:scale(1.04)}}
/* Shuffle: light streams across the glyph from left to right. */
.dshmp-mode-shuffle.dshmp-selected .dshmp-mode>svg{
  -webkit-mask-image:linear-gradient(90deg,#000 0%,#000 28%,rgba(0,0,0,.52) 33%,#000 38%,#000 61%,rgba(0,0,0,.52) 66%,#000 71%,#000 100%);
  mask-image:linear-gradient(90deg,#000 0%,#000 28%,rgba(0,0,0,.52) 33%,#000 38%,#000 61%,rgba(0,0,0,.52) 66%,#000 71%,#000 100%);
  -webkit-mask-size:300% 100%;mask-size:300% 100%;
  -webkit-mask-repeat:no-repeat;mask-repeat:no-repeat;
  -webkit-mask-position:100% 50%;mask-position:100% 50%;
  animation:dshmp-icon-pulse var(--dshmp-beat) ease-out infinite, dshmp-flow-x calc(var(--dshmp-beat) * 2) linear infinite}
@keyframes dshmp-flow-x{
  0%{-webkit-mask-position:100% 50%;mask-position:100% 50%}
  100%{-webkit-mask-position:0% 50%;mask-position:0% 50%}}
.dshmp-mode:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.dshmp-panel{position:absolute;z-index:3;display:flex;flex-direction:column;gap:14px;padding:18px;border-radius:20px;overflow:auto;
  pointer-events:none;opacity:0;visibility:hidden;transform:translateY(8px) scale(.98);
  background:
    linear-gradient(160deg,rgba(255,255,255,.15) 0%,rgba(255,255,255,.03) 48%,rgba(255,255,255,.07) 100%),
    rgba(14,16,22,.50);
  background:
    linear-gradient(160deg,rgba(255,255,255,.15) 0%,rgba(255,255,255,.03) 48%,rgba(255,255,255,.07) 100%),
    color-mix(in srgb,var(--dsw-alias-bg-overlay) 60%,transparent);
  -webkit-backdrop-filter:blur(26px) saturate(185%);backdrop-filter:blur(26px) saturate(185%);
  border:1px solid rgba(255,255,255,.26);
  box-shadow:0 22px 54px rgba(0,0,0,.34),inset 0 1px 0 rgba(255,255,255,.26);
  transition:opacity .2s ease,transform .28s cubic-bezier(.22,.68,.24,1),visibility .2s}
.dshmp-panel.dshmp-visible{opacity:1;visibility:visible;transform:none;pointer-events:auto}
.dshmp-head{display:flex;align-items:flex-start;gap:10px}
.dshmp-headtext{flex:1;min-width:0}
.dshmp-title{font-size:15px;font-weight:600;line-height:1.35}
.dshmp-sub{font-size:13px;line-height:1.4;margin-top:2px;color:var(--dsw-alias-label-secondary)}
.dshmp-iconbtn{flex:none;width:28px;height:28px;display:grid;place-items:center;border:0;padding:0;border-radius:50%;cursor:pointer;
  background:rgba(255,255,255,.12);color:var(--dsw-alias-label-secondary);
  transition:background .16s ease,color .16s ease}
.dshmp-iconbtn:hover{background:rgba(255,255,255,.24);color:var(--dsw-alias-label-primary)}
.dshmp-field{display:flex;align-items:center;gap:10px;height:44px;padding:0 13px;border-radius:999px;
  background:rgba(255,255,255,.10);color:var(--dsw-alias-label-secondary);
  box-shadow:inset 0 0 0 1px rgba(255,255,255,.16);transition:background .18s ease,box-shadow .18s ease}
.dshmp-field:focus-within{background:rgba(255,255,255,.17);box-shadow:inset 0 0 0 1px rgba(255,255,255,.36);color:var(--dsw-alias-label-primary)}
.dshmp-input{flex:1;min-width:0;border:0;outline:0;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:14.5px;line-height:1.28}
.dshmp-input::placeholder{color:var(--dsw-alias-label-secondary);opacity:.9}
.dshmp-badge{flex:none;font-size:12px;line-height:1;padding:3px 7px;border-radius:999px;white-space:nowrap;
  background:rgba(255,255,255,.16);color:var(--dsw-alias-label-secondary)}
.dshmp-note{margin:0;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-secondary)}
.dshmp-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dshmp-now{display:flex;align-items:center;gap:8px;font-size:11.5px;min-width:0}
.dshmp-now-label{flex:none;font-size:10px;line-height:1;padding:3px 7px;border-radius:999px;
  background:rgba(255,255,255,.16);color:var(--dsw-alias-label-secondary);white-space:nowrap}
.dshmp-now-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshmp-sect{display:flex;flex-direction:column;gap:6px}
.dshmp-sect-label{font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--dsw-alias-label-secondary)}
.dshmp-label-row{display:flex;align-items:center;gap:6px}
.dshmp-help-btn{flex:none;width:15px;height:15px;display:grid;place-items:center;border:0;padding:0;border-radius:50%;
  background:rgba(255,255,255,.16);color:var(--dsw-alias-label-secondary);font:inherit;font-size:10px;line-height:1;cursor:pointer;
  transition:background .16s ease,color .16s ease}
.dshmp-help-btn:hover{background:rgba(255,255,255,.3);color:var(--dsw-alias-label-primary)}
.dshmp-help{display:flex;flex-direction:column;gap:4px;margin:0;padding:10px 12px 10px 30px;border-radius:10px;
  background:rgba(255,255,255,.06);box-shadow:inset 0 0 0 1px rgba(255,255,255,.10);
  font-size:14px;line-height:1.6;color:var(--dsw-alias-label-secondary)}
.dshmp-help li{padding-left:2px}
.dshmp-help-example{margin-top:3px;font-size:12px;opacity:.75;word-break:break-all}
.dshmp-help-face{margin-left:2px}
.dshmp-list{display:flex;flex-direction:column;gap:2px;max-height:244px;overflow:auto;padding:4px;border-radius:12px;
  background:rgba(255,255,255,.05);box-shadow:inset 0 0 0 1px rgba(255,255,255,.08)}
.dshmp-track{display:flex;align-items:center;gap:8px;min-height:34px;padding:6px 10px;border:0;border-radius:9px;cursor:pointer;
  background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13.5px;text-align:left}
.dshmp-track:hover{background:rgba(255,255,255,.12)}
.dshmp-track.dshmp-current{background:rgba(255,255,255,.22)}
.dshmp-track-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshmp-track-dur{flex:none;font-size:12.5px;opacity:.6;font-variant-numeric:tabular-nums}
.dshmp-inline-btn{flex:none;height:24px;padding:0 10px;border:0;border-radius:999px;cursor:pointer;
  background:rgba(255,255,255,.24);color:inherit;font:inherit;font-size:11px;transition:background .16s ease}
.dshmp-inline-btn:hover{background:rgba(255,255,255,.38)}
.dshmp-progress{position:absolute;left:14px;right:14px;bottom:2px;z-index:3;display:flex;align-items:center;
  height:10px;cursor:pointer;touch-action:none;opacity:0;transition:opacity .2s ease}
.dshmp-bar .dshmp-progress{opacity:1}
.dshmp-circle .dshmp-progress{pointer-events:none}
.dshmp-progress::before{content:'';position:absolute;left:0;right:0;top:50%;height:2px;margin-top:-1px;border-radius:2px;
  background:rgba(255,255,255,.16)}
.dshmp-progress:hover::before{background:rgba(255,255,255,.28)}
.dshmp-progress span{position:relative;display:block;height:2px;border-radius:2px;background:rgba(255,255,255,.72);
  transition:width .25s linear}
.dshmp-time{display:flex;align-items:center;gap:8px}
.dshmp-time-label{flex:none;min-width:38px;font-size:12.5px;text-align:center;opacity:.65;font-variant-numeric:tabular-nums}
.dshmp-seek,.dshmp-volume-track{position:relative;flex:1;height:6px;border-radius:3px;background:rgba(255,255,255,.14);
  cursor:pointer;touch-action:none}
.dshmp-seek:hover,.dshmp-volume-track:hover{background:rgba(255,255,255,.22)}
.dshmp-seek-fill{position:absolute;left:0;top:0;bottom:0;border-radius:3px;background:rgba(255,255,255,.66);pointer-events:none}
.dshmp-seek-knob{position:absolute;top:50%;width:10px;height:10px;margin-left:-5px;border-radius:50%;background:#fff;pointer-events:none;
  transform:translateY(-50%);box-shadow:0 1px 4px rgba(0,0,0,.45);opacity:0;transition:opacity .15s ease}
.dshmp-seek:hover .dshmp-seek-knob,.dshmp-scrubbing .dshmp-seek-knob,.dshmp-volume-track:hover .dshmp-seek-knob{opacity:1}
.dshmp-scrubbing span{transition:none}
.dshmp-volume{display:flex;align-items:center;gap:8px}
.dshmp-audio{display:none}
.dshmp-pills{display:flex;gap:8px;flex-wrap:wrap}
.dshmp-pill{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 14px;border:0;border-radius:999px;cursor:pointer;
  font:inherit;font-size:13.5px;color:var(--dsw-alias-label-secondary);background:rgba(255,255,255,.10);
  box-shadow:inset 0 0 0 1px rgba(255,255,255,.14);
  transition:background .16s ease,color .16s ease,box-shadow .16s ease}
.dshmp-pill:hover{background:rgba(255,255,255,.20);color:var(--dsw-alias-label-primary)}
.dshmp-pill.dshmp-on{background:rgba(255,255,255,.32);color:var(--dsw-alias-label-primary);box-shadow:inset 0 0 0 1px rgba(255,255,255,.44)}
.dshmp-pill:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.dshmp-msg{font-size:13px;line-height:1.45;color:var(--dsw-alias-state-success-primary);opacity:0;transform:translateY(-2px);transition:opacity .2s ease,transform .2s ease}
.dshmp-msg.dshmp-on{opacity:1;transform:none}
.dshmp-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12.5px;line-height:1.4;padding-top:9px;border-top:1px solid rgba(255,255,255,.10);color:var(--dsw-alias-label-secondary)}
.dshmp-build{flex:none;opacity:.75;font-variant-numeric:tabular-nums}
@keyframes dshmp-spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}

@media (prefers-reduced-motion: reduce){
  .dshmp-stage,.dshmp-vinyl,.dshmp-panel,.dshmp-gear{transition-duration:.01ms!important}
  .dshmp-disc-spin{animation:none}
  .dshmp-ripple,.dshmp-mode-wrap.dshmp-selected .dshmp-mode>svg{animation:none}
}
`

    // ------------------------------------------------------------------ player
    function createPlayer(ctx) {
      return function MusicPlayer() {
        const [viewport, setViewport] = useState(() => ({
          w: window.innerWidth || 1280,
          h: window.innerHeight || 800,
        }))
        const [lang, setLang] = useState(() => detectLang(ctx))

        useEffect(() => {
          const onResize = () => setViewport({ w: window.innerWidth, h: window.innerHeight })
          window.addEventListener('resize', onResize)
          return () => window.removeEventListener('resize', onResize)
        }, [])

        useEffect(() => {
          let dispose
          try {
            const locale = ctx.get('locale')
            if (locale && typeof locale.subscribe === 'function') {
              dispose = locale.subscribe(() => setLang(detectLang(ctx)))
            }
          } catch (error) {
            /* locale is optional */
          }
          return () => {
            if (typeof dispose === 'function') {
              try {
                dispose()
              } catch (error) {
                /* ignore */
              }
            }
          }
        }, [])

        const t = (key) => {
          const dict = COPY[lang] || COPY.zh
          return dict[key] || COPY.zh[key] || key
        }

        const diameter = Math.round(clamp(viewport.w * 0.078, 58, 76))
        const barWidth = Math.round(Math.min(BAR_NATURAL, viewport.w - MARGIN * 2))
        // 0.84 * sqrt(0.9): the disc area is 10% smaller than the first draft.
        const vinylSize = Math.round(diameter * 0.797)

        const [phase, setPhase] = useState('circle')
        const [playing, setPlaying] = useState(false)
        const [mode, setMode] = useState(() => (readStore(MODE_KEY) === 'repeat' ? 'repeat' : 'shuffle'))
        const [panelOpen, setPanelOpen] = useState(false)
        const [dragging, setDragging] = useState(false)
        const [hint, setHint] = useState('')
        const [busy, setBusy] = useState('')
        const [search, setSearch] = useState('')
        const [playlist, setPlaylist] = useState('')
        const [activeLink, setActiveLink] = useState('')

        const [tracks, setTracks] = useState([])
        const [playlistTitle, setPlaylistTitle] = useState('')
        const [playlistPage, setPlaylistPage] = useState(1)
        const [helpOpen, setHelpOpen] = useState(false)
        const [hostVersion, setHostVersion] = useState('')
        const [hasMore, setHasMore] = useState(false)
        const [currentIndex, setCurrentIndex] = useState(-1)
        const [tempTrack, setTempTrack] = useState(null)
        const [results, setResults] = useState(null)
        const [progress, setProgress] = useState(0)
        const [duration, setDuration] = useState(0)
        const [scrub, setScrubState] = useState(null)
        const [volume, setVolume] = useState(() => {
          const raw = Number(readStore(VOLUME_KEY))
          return Number.isFinite(raw) && raw >= 0 && raw <= 1 ? raw : 0.8
        })
        const [muted, setMuted] = useState(false)

        const [position, setPositionState] = useState(
          () =>
            readPosition() || {
              x: Math.max(MARGIN, viewport.w - diameter - 28),
              y: Math.round(viewport.h * 0.58),
            },
        )
        const positionRef = useRef(position)
        const dragRef = useRef(null)
        const hintTimer = useRef(null)
        const anchorRef = useRef(null)
        const collapseRef = useRef(() => {})
        const audioRef = useRef(null)
        const resumeRef = useRef(-1)
        const tracksRef = useRef([])
        const tempTrackRef = useRef(null)
        const currentIndexRef = useRef(-1)
        const playingBvidRef = useRef('')
        const refreshRef = useRef(() => {})
        const refreshedAtRef = useRef(0)
        const scrubRef = useRef(null)
        const volumeDragRef = useRef(false)
        const durationRef = useRef(0)
        const seekGuardRef = useRef(0)
        const blobUrlRef = useRef('')
        const settingsTimerRef = useRef(null)
        const pendingSettingsRef = useRef({})
        const loadSeqRef = useRef(0)
        const mutePauseRef = useRef(false)
        const modeTimerRef = useRef(null)
        const [modeBar, setModeBar] = useState(false)

        const setPosition = (next) => {
          positionRef.current = next
          setPositionState(next)
        }

        useEffect(
          () => () => {
            if (hintTimer.current) clearTimeout(hintTimer.current)
            if (modeTimerRef.current) clearTimeout(modeTimerRef.current)
            if (blobUrlRef.current) {
              try {
                URL.revokeObjectURL(blobUrlRef.current)
              } catch (error) {
                /* already gone */
              }
            }
          },
          [],
        )

        useEffect(() => {
          if (!panelOpen) return undefined
          // Opening the panel re-reads the folder so the list is never stale.
          refreshRef.current()
          const onKey = (event) => {
            if (event.key === 'Escape') setPanelOpen(false)
          }
          window.addEventListener('keydown', onKey)
          return () => window.removeEventListener('keydown', onKey)
        }, [panelOpen])

        const width = phase === 'circle' ? diameter : barWidth
        const stage = {
          x: clamp(position.x, MARGIN, Math.max(MARGIN, viewport.w - width - MARGIN)),
          y: clamp(position.y, MARGIN, Math.max(MARGIN, viewport.h - diameter - MARGIN)),
        }

        const flash = (message) => {
          setHint(message)
          if (hintTimer.current) clearTimeout(hintTimer.current)
          hintTimer.current = setTimeout(() => setHint(''), 3200)
        }

        /** Persist player settings into the plugin package (host side). */
        function saveSettings(patch) {
          if (typeof fetch !== 'function') return
          pendingSettingsRef.current = { ...pendingSettingsRef.current, ...patch }
          if (settingsTimerRef.current) clearTimeout(settingsTimerRef.current)
          settingsTimerRef.current = setTimeout(() => {
            settingsTimerRef.current = null
            const body = pendingSettingsRef.current
            pendingSettingsRef.current = {}
            fetch(API_BASE + '/api/settings', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(body),
            }).catch(() => {})
          }, 350)
        }

        const expand = () => {
          // Remember where the circle was: the bar is clamped to the viewport, so
          // its box centre is NOT the circle centre and collapsing from it would
          // walk the widget sideways on every cycle.
          anchorRef.current = { x: stage.x, y: stage.y }
          const centerX = stage.x + diameter / 2
          setPosition({
            x: clamp(centerX - barWidth / 2, MARGIN, Math.max(MARGIN, viewport.w - barWidth - MARGIN)),
            y: stage.y,
          })
          setPhase('bar')
        }

        const collapse = () => {
          const anchor = anchorRef.current
          anchorRef.current = null
          const fallbackX = stage.x + barWidth / 2 - diameter / 2
          setPosition({
            x: clamp(anchor ? anchor.x : fallbackX, MARGIN, Math.max(MARGIN, viewport.w - diameter - MARGIN)),
            y: clamp(anchor ? anchor.y : stage.y, MARGIN, Math.max(MARGIN, viewport.h - diameter - MARGIN)),
          })
          setPhase('circle')
          setPanelOpen(false)
          setModeBar(false)
        }

        // Assign after every render so the outside-click listener always calls
        // the current closure.
        useEffect(() => {
          collapseRef.current = collapse
          tracksRef.current = tracks
          tempTrackRef.current = tempTrack
          currentIndexRef.current = currentIndex
          refreshRef.current = refreshPlaylist
        })

        // While expanded, a pointer down anywhere outside the player's own
        // surfaces (bar, gear, panel) collapses it immediately.
        useEffect(() => {
          if (phase !== 'bar') return undefined
          const onOutsidePointerDown = (event) => {
            const target = event.target
            if (target && typeof target.closest === 'function' && target.closest('[data-dshmp-surface]')) return
            collapseRef.current()
          }
          document.addEventListener('pointerdown', onOutsidePointerDown, true)
          return () => document.removeEventListener('pointerdown', onOutsidePointerDown, true)
        }, [phase])

        const onPointerDown = (event) => {
          if (event.pointerType === 'mouse' && event.button !== 0) return
          dragRef.current = {
            id: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            originX: stage.x,
            originY: stage.y,
            moved: false,
          }
          setDragging(true)
          try {
            event.currentTarget.setPointerCapture(event.pointerId)
          } catch (error) {
            /* capture is best effort */
          }
        }

        const onPointerMove = (event) => {
          const drag = dragRef.current
          if (!drag || drag.id !== event.pointerId) return
          const dx = event.clientX - drag.x
          const dy = event.clientY - drag.y
          if (!drag.moved) {
            if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return
            drag.moved = true
          }
          setPosition({
            x: clamp(drag.originX + dx, MARGIN, Math.max(MARGIN, viewport.w - width - MARGIN)),
            y: clamp(drag.originY + dy, MARGIN, Math.max(MARGIN, viewport.h - diameter - MARGIN)),
          })
        }

        const endDrag = (event, cancelled) => {
          const drag = dragRef.current
          dragRef.current = null
          setDragging(false)
          try {
            if (event && event.currentTarget.releasePointerCapture) {
              event.currentTarget.releasePointerCapture(event.pointerId)
            }
          } catch (error) {
            /* ignore */
          }
          if (!drag) return
          if (drag.moved) {
            writePosition({ x: stage.x, y: stage.y })
            saveSettings({ position: { x: stage.x, y: stage.y } })
            if (phase === 'bar') {
              // The bar was dragged: collapse back under the bar's centre.
              anchorRef.current = {
                x: clamp(
                  stage.x + barWidth / 2 - diameter / 2,
                  MARGIN,
                  Math.max(MARGIN, viewport.w - diameter - MARGIN),
                ),
                y: clamp(stage.y, MARGIN, Math.max(MARGIN, viewport.h - diameter - MARGIN)),
              }
            }
            return
          }
          if (cancelled) return
          if (phase === 'circle') expand()
          else if (panelOpen) setPanelOpen(false)
          else collapse()
        }

        const stopPointer = (event) => {
          event.stopPropagation()
        }

        const togglePlay = (event) => {
          event.stopPropagation()
          const audio = audioRef.current
          if (!audio) return
          if (!audio.getAttribute('src')) {
            if (!tracks.length) {
              flash(t('noPlaylist'))
              return
            }
            const index = currentIndex < 0 ? 0 : currentIndex
            playTrack(tracks[index], index, false)
            return
          }
          if (audio.paused) {
            setPlaying(true)
            const started = audio.play()
            if (started && typeof started.catch === 'function') {
              started.catch(() => flash(t('playFailed')))
            }
          } else {
            audio.pause()
            setPlaying(false)
          }
        }

        const playTrack = (track, index, temporary) => {
          const audio = audioRef.current
          if (!audio || !track || !track.bvid) return
          resumeRef.current = temporary ? (currentIndex < 0 ? 0 : currentIndex) : index
          setCurrentIndex(temporary ? -1 : index)
          setTempTrack(temporary ? track : null)
          setPlaying(true)
          setProgress(0)
          setDuration(Number(track.duration) || 0)
          durationRef.current = Number(track.duration) || 0
          playingBvidRef.current = track.bvid
          // Every track change (and every repeat) re-reads the folder quietly.
          refreshRef.current()

          const seq = loadSeqRef.current + 1
          loadSeqRef.current = seq
          const streamUrl = API_BASE + '/stream?bvid=' + encodeURIComponent(track.bvid)

          const start = () => {
            mutePauseRef.current = false
            const started = audio.play()
            if (started && typeof started.catch === 'function') {
              started.catch((error) => {
                setPlaying(false)
                flash(t('playFailed') + '：' + (error.message || error.name || 'unknown'))
              })
            }
          }

          // Long media (over 20 minutes) streams directly: buffering it whole
          // would cost too much memory and time.
          if (Number(track.duration) > 1200) {
            audio.src = streamUrl
            start()
            return
          }

          // Short tracks are buffered into a Blob first. A complete local
          // resource is what makes <audio> seek by time reliably; against a live
          // Range stream the browser can refuse the seek and restart at zero.
          mutePauseRef.current = true
          try {
            audio.pause()
          } catch (error) {
            /* ignore */
          }
          setBusy(t('buffering'))
          fetch(streamUrl)
            .then((response) => {
              if (!response.ok) throw new Error('HTTP ' + response.status)
              return response.blob()
            })
            .then((blob) => {
              if (loadSeqRef.current !== seq) return
              const url = URL.createObjectURL(blob)
              const previous = blobUrlRef.current
              blobUrlRef.current = url
              audio.src = url
              start()
              if (previous) {
                try {
                  URL.revokeObjectURL(previous)
                } catch (error) {
                  /* already revoked */
                }
              }
            })
            .catch((error) => {
              if (loadSeqRef.current !== seq) return
              mutePauseRef.current = false
              setPlaying(false)
              flash(t('playFailed') + '：' + (error.message || 'unknown'))
            })
            .finally(() => {
              if (loadSeqRef.current === seq) setBusy('')
            })
        }

        const step = (delta) => {
          if (!tracks.length) {
            flash(t('noPlaylist'))
            return
          }
          const base = currentIndex < 0 ? 0 : currentIndex
          let next = (base + delta + tracks.length) % tracks.length
          if (mode === 'shuffle' && delta > 0 && tracks.length > 1) {
            do {
              next = Math.floor(Math.random() * tracks.length)
            } while (next === base)
          }
          playTrack(tracks[next], next, false)
        }

        const handleEnded = () => {
          if (tempTrack) {
            const resume = resumeRef.current
            setTempTrack(null)
            if (tracks.length) {
              const index = resume >= 0 && resume < tracks.length ? resume : 0
              playTrack(tracks[index], index, false)
            } else {
              setPlaying(false)
            }
            return
          }
          if (!tracks.length) {
            setPlaying(false)
            return
          }
          const index = currentIndex < 0 ? 0 : currentIndex
          if (mode === 'repeat') {
            playTrack(tracks[index], index, false)
            return
          }
          step(1)
        }

        /**
         * Total length in seconds. Fragmented Bilibili streams often report
         * `Infinity` as duration, so the playlist duration is the fallback.
         */
        const audioTotal = () => {
          const audio = audioRef.current
          if (audio) {
            const total = Number(audio.duration)
            if (Number.isFinite(total) && total > 0) return total
          }
          return durationRef.current > 0 ? durationRef.current : 0
        }

        const handleTimeUpdate = () => {
          const audio = audioRef.current
          if (!audio) return
          // A seek is in flight: ignore the timeupdate that still carries the
          // pre-seek position, otherwise the bar snaps back.
          if (Date.now() < seekGuardRef.current) return
          const total = audioTotal()
          if (total <= 0) {
            setProgress(0)
            return
          }
          setProgress(Math.max(0, Math.min(1, audio.currentTime / total)))
        }

        const handleLoadedMetadata = () => {
          const audio = audioRef.current
          if (audio && Number.isFinite(audio.duration) && audio.duration > 0) {
            durationRef.current = audio.duration
            setDuration(audio.duration)
          }
        }

        const setScrub = (value) => {
          scrubRef.current = value
          setScrubState(value)
        }

        const ratioAt = (event) => {
          const rect = event.currentTarget.getBoundingClientRect()
          if (!rect.width) return 0
          return Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
        }

        const applySeek = (ratio) => {
          const audio = audioRef.current
          if (!audio) return
          const total = audioTotal()
          if (total <= 0) return
          let target = Math.max(0, Math.min(total - 0.25, ratio * total))
          try {
            const ranges = audio.seekable
            if (ranges && ranges.length) {
              const start = ranges.start(0)
              const end = ranges.end(0)
              if (Number.isFinite(end) && end > start) {
                target = Math.max(start, Math.min(end - 0.25, target))
              }
            }
          } catch (error) {
            /* seekable is unavailable on some streams */
          }
          try {
            audio.currentTime = target
          } catch (error) {
            /* a stream that refuses the seek must not break the handler */
          }
          seekGuardRef.current = Date.now() + 900
          setProgress(Math.max(0, Math.min(1, target / total)))
        }

        const beginSeek = (event) => {
          event.stopPropagation()
          event.preventDefault()
          try {
            event.currentTarget.setPointerCapture(event.pointerId)
          } catch (error) {
            /* capture is best effort */
          }
          setScrub(ratioAt(event))
        }

        const moveSeek = (event) => {
          if (scrubRef.current === null) return
          event.stopPropagation()
          setScrub(ratioAt(event))
        }

        const endSeek = (event) => {
          event.stopPropagation()
          const ratio = scrubRef.current
          setScrub(null)
          if (ratio !== null) applySeek(ratio)
        }

        const beginVolume = (event) => {
          event.stopPropagation()
          event.preventDefault()
          volumeDragRef.current = true
          try {
            event.currentTarget.setPointerCapture(event.pointerId)
          } catch (error) {
            /* capture is best effort */
          }
          setVolume(ratioAt(event))
        }

        const moveVolume = (event) => {
          if (!volumeDragRef.current) return
          event.stopPropagation()
          setVolume(ratioAt(event))
        }

        const endVolume = (event) => {
          event.stopPropagation()
          volumeDragRef.current = false
        }

        const toggleMute = (event) => {
          event.stopPropagation()
          setMuted((value) => !value)
        }

        /** Mode is sticky: chosen once, kept across expand/collapse and reloads. */
        const chooseMode = (next) => {
          setMode(next)
          writeStore(MODE_KEY, next)
          saveSettings({ mode: next })
        }

        const revealModes = () => {
          if (modeTimerRef.current) {
            clearTimeout(modeTimerRef.current)
            modeTimerRef.current = null
          }
          setModeBar(true)
        }

        const hideModesSoon = () => {
          if (modeTimerRef.current) clearTimeout(modeTimerRef.current)
          modeTimerRef.current = setTimeout(() => {
            modeTimerRef.current = null
            setModeBar(false)
          }, 260)
        }

        // If the pointer is released outside the handle (lost capture, window
        // focus change), the scrub must still commit instead of sticking.
        useEffect(() => {
          if (scrub === null) return undefined
          const finish = () => {
            const ratio = scrubRef.current
            setScrub(null)
            if (ratio !== null) applySeek(ratio)
          }
          window.addEventListener('pointerup', finish)
          window.addEventListener('pointercancel', finish)
          return () => {
            window.removeEventListener('pointerup', finish)
            window.removeEventListener('pointercancel', finish)
          }
        }, [scrub === null])

        useEffect(() => {
          const audio = audioRef.current
          if (audio) {
            audio.volume = volume
            audio.muted = muted
          }
          writeStore(VOLUME_KEY, String(volume))
          saveSettings({ volume })
        }, [volume, muted])

        const api = async (path, params) => {
          const query = params ? '?' + new URLSearchParams(params).toString() : ''
          const response = await fetch(API_BASE + path + query, { headers: { accept: 'application/json' } })
          let body = null
          try {
            body = await response.json()
          } catch (error) {
            body = null
          }
          if (!body || !body.ok) throw new Error((body && body.error) || 'HTTP ' + response.status)
          return body
        }

        const loadPlaylist = async (link, page) => {
          const target = String(link || playlist || '').trim()
          if (!target) return
          setActiveLink(target)
          setBusy(t('loadingPlaylist'))
          try {
            const body = await api('/api/playlist', { link: target, page: String(page || 1) })
            const items = Array.isArray(body.items) ? body.items : []
            setTracks((previous) => ((page || 1) > 1 ? previous.concat(items) : items))
            setPlaylistTitle(String(body.title || ''))
            setPlaylistPage(page || 1)
            setHasMore(Boolean(body.hasMore))
            setPlaylist(target)
            writeStore(LINK_KEY, target)
            saveSettings({ link: target })
            if ((page || 1) === 1) {
              writeStore(TRACKS_KEY, JSON.stringify({ title: body.title || '', items }))
            }
          } catch (error) {
            flash(t('loadFailed') + '：' + error.message)
          } finally {
            setBusy('')
          }
        }

        const submitPlaylist = (event) => {
          event.preventDefault()
          loadPlaylist(playlist, 1)
        }

        /**
         * Background refresh: re-read page 1 and merge it in front of the pages
         * already loaded, so new favorites appear and the playing track keeps its
         * position without touching the audio element.
         */
        async function refreshPlaylist() {
          const target = String(activeLink || '').trim()
          if (!target) return
          const now = Date.now()
          if (tracksRef.current.length && now - refreshedAtRef.current < 3000) return
          refreshedAtRef.current = now
          try {
            const body = await api('/api/playlist', { link: target, page: '1' })
            const fresh = Array.isArray(body.items) ? body.items : []
            const seen = new Set(fresh.map((item) => item.bvid))
            const merged = fresh.concat(tracksRef.current.filter((item) => !seen.has(item.bvid)))
            const title = String(body.title || '') || playlistTitle
            setTracks(merged)
            setPlaylistTitle(title)
            setHasMore(Boolean(body.hasMore))
            writeStore(TRACKS_KEY, JSON.stringify({ title, items: merged }))
            const playingBvid = playingBvidRef.current
            const found = playingBvid ? merged.findIndex((item) => item.bvid === playingBvid) : -1
            if (found >= 0) {
              if (tempTrackRef.current) resumeRef.current = found
              else setCurrentIndex(found)
            } else if (currentIndexRef.current >= merged.length) {
              setCurrentIndex(merged.length - 1)
            }
          } catch (error) {
            /* a background refresh stays quiet so listening is never interrupted */
          }
        }

        const submitSearch = async (event) => {
          event.preventDefault()
          const keyword = search.trim()
          if (!keyword) return
          setBusy(t('searching'))
          try {
            const body = await api('/api/search', { q: keyword })
            const items = Array.isArray(body.items) ? body.items : []
            setResults(items)
            if (!items.length) flash(t('noResults'))
          } catch (error) {
            flash(t('searchFailed') + '：' + error.message)
          } finally {
            setBusy('')
          }
        }


        // Restore from the plugin's own settings file (survives port changes and
        // restarts), falling back to the localStorage mirror.
        useEffect(() => {
          if (typeof fetch !== 'function') return undefined
          let cancelled = false
          const cached = readStore(TRACKS_KEY)
          if (cached) {
            try {
              const parsed = JSON.parse(cached)
              if (parsed && Array.isArray(parsed.items) && parsed.items.length) {
                setTracks(parsed.items)
                setPlaylistTitle(String(parsed.title || ''))
              }
            } catch (error) {
              /* a corrupt cache is simply ignored */
            }
          }
          const fallback = readStore(LINK_KEY) || DEFAULT_LINK
          const restore = (saved) => {
            // Write the resolved mode back so the file is complete even before the
            // first click (localStorage is only a mirror and dies with the port).
            const resolvedMode =
              saved.mode === 'repeat' || saved.mode === 'shuffle'
                ? saved.mode
                : readStore(MODE_KEY) === 'repeat'
                  ? 'repeat'
                  : 'shuffle'
            setMode(resolvedMode)
            saveSettings({ mode: resolvedMode })
            if (typeof saved.volume === 'number' && saved.volume >= 0 && saved.volume <= 1) {
              setVolume(saved.volume)
            }
            if (saved.position && Number.isFinite(saved.position.x) && Number.isFinite(saved.position.y)) {
              setPosition({ x: saved.position.x, y: saved.position.y })
            }
            const link = typeof saved.link === 'string' && saved.link.trim() ? saved.link : fallback
            setPlaylist(link)
            loadPlaylist(link, 1)
          }
          fetch(API_BASE + '/api/settings')
            .then((response) => response.json())
            .then((body) => {
              if (cancelled) return
              if (body && typeof body.version === 'string' && body.version) setHostVersion(body.version)
              restore(body && body.ok && body.settings ? body.settings : {})
            })
            .catch(() => {
              if (cancelled) return
              restore({})
            })
          return () => {
            cancelled = true
          }
        }, [])

        const gearBelow = stage.y + diameter + GAP + GEAR <= viewport.h - MARGIN
        const gearY = gearBelow
          ? stage.y + diameter + GAP
          : Math.max(MARGIN, stage.y - GAP - GEAR)
        const gearX = clamp(
          stage.x + width / 2 - GEAR / 2,
          MARGIN,
          Math.max(MARGIN, viewport.w - GEAR - MARGIN),
        )

        const panelWidth = Math.round(Math.min(470, Math.max(320, viewport.w - MARGIN * 2)))
        const panelX = clamp(
          stage.x + width / 2 - panelWidth / 2,
          MARGIN,
          Math.max(MARGIN, viewport.w - panelWidth - MARGIN),
        )
        const clusterTop = Math.min(stage.y, gearY)
        const clusterBottom = Math.max(stage.y + diameter, gearY + GEAR)
        const roomAbove = clusterTop - MARGIN
        const placeAbove = roomAbove >= 220
        const panelMaxHeight = Math.max(
          150,
          placeAbove ? roomAbove - GAP : viewport.h - clusterBottom - GAP - MARGIN,
        )
        const panelStyle = {
          width: panelWidth,
          maxHeight: panelMaxHeight,
          left: panelX,
        }
        if (placeAbove) panelStyle.bottom = viewport.h - clusterTop + GAP
        else panelStyle.top = clusterBottom + GAP

        const currentTitle = tempTrack
          ? tempTrack.title
          : tracks[currentIndex]
            ? tracks[currentIndex].title
            : ''
        const displayedRatio = scrub === null ? progress : scrub
        const displayedTime = duration > 0 ? displayedRatio * duration : 0
        const volumeRatio = muted ? 0 : volume

        // Dot body + 1px border are SVG circles. Motion lives on the icon now:
        // repeat-one ripples out of the centre, shuffle streams left to right.
        const modeRing = (kind, active) =>
          h(
            'svg',
            { className: 'dshmp-ring', viewBox: '0 0 44 44', 'aria-hidden': 'true', focusable: 'false' },
            h('circle', {
              key: 'base',
              cx: 22,
              cy: 22,
              r: 18.5,
              fill: 'none',
              stroke: 'rgba(255,255,255,0.22)',
              strokeWidth: 1,
            }),
            active && kind === 'repeat'
              ? h('circle', {
                  key: 'ripple',
                  className: 'dshmp-ripple',
                  cx: 22,
                  cy: 22,
                  r: 11,
                  fill: 'none',
                  stroke: '#ffffff',
                  strokeWidth: 1.5,
                })
              : null,
          )

        // Same treatment for the gear: its border is an SVG circle too.
        const gearRing = () =>
          h(
            'svg',
            { className: 'dshmp-gear-ring', viewBox: '0 0 44 44', 'aria-hidden': 'true', focusable: 'false' },
            h('circle', {
              cx: 22,
              cy: 22,
              r: 21,
              fill: 'none',
              stroke: 'rgba(255,255,255,0.24)',
              strokeWidth: 1,
            }),
          )

        const stageClass = [
          'dshmp-stage',
          phase === 'circle' ? 'dshmp-circle' : 'dshmp-bar',
          dragging ? 'dshmp-dragging' : '',
          playing ? '' : 'dshmp-paused',
        ]
          .filter(Boolean)
          .join(' ')

        const gearClass = ['dshmp-gear', phase === 'bar' ? 'dshmp-visible' : '', panelOpen ? 'dshmp-open' : '']
          .filter(Boolean)
          .join(' ')

        return h(
          React.Fragment,
          null,
          h('style', { key: 'style' }, CSS),
          h(
            'div',
            { key: 'root', className: 'dshmp-root', 'data-dsh-music-player': '' },
            h(
              'div',
              {
                className: stageClass,
                style: {
                  width: width,
                  height: diameter,
                  transform: 'translate3d(' + stage.x + 'px,' + stage.y + 'px,0)',
                },
                onPointerDown: onPointerDown,
                onPointerMove: onPointerMove,
                onPointerUp: (event) => endDrag(event, false),
                onPointerCancel: (event) => endDrag(event, true),
                onLostPointerCapture: () => {
                  if (dragRef.current) {
                    dragRef.current = null
                    setDragging(false)
                  }
                },
                role: 'group',
                'aria-label': t('expand'),
                'data-dshmp-surface': 'stage',
                tabIndex: phase === 'circle' ? 0 : -1,
                onKeyDown: (event) => {
                  if (phase !== 'circle') return
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    expand()
                  }
                },
              },
              h('div', { key: 'glass', className: 'dshmp-glass' }),
              h(
                'svg',
                {
                  key: 'vinyl',
                  className: 'dshmp-vinyl',
                  viewBox: '0 0 100 100',
                  width: vinylSize,
                  height: vinylSize,
                  preserveAspectRatio: 'xMidYMid meet',
                  'aria-hidden': 'true',
                  focusable: 'false',
                },
                h(
                  'defs',
                  { key: 'defs' },
                  h(
                    'radialGradient',
                    { key: 'body', id: 'dshmp-grad-body', cx: '50%', cy: '50%', r: '50%' },
                    h('stop', { key: 'a', offset: '0%', stopColor: '#232430' }),
                    h('stop', { key: 'b', offset: '46%', stopColor: '#17181d' }),
                    h('stop', { key: 'c', offset: '100%', stopColor: '#06070a' }),
                  ),
                  h(
                    'radialGradient',
                    { key: 'sheen', id: 'dshmp-grad-sheen', cx: '74%', cy: '22%', r: '70%' },
                    h('stop', { key: 'a', offset: '0%', stopColor: '#ffffff', stopOpacity: 0.22 }),
                    h('stop', { key: 'b', offset: '34%', stopColor: '#ffffff', stopOpacity: 0.06 }),
                    h('stop', { key: 'c', offset: '100%', stopColor: '#ffffff', stopOpacity: 0 }),
                  ),
                ),
                h(
                  'g',
                  { key: 'disc', className: 'dshmp-disc-spin' },
                  h('circle', { key: 'body', cx: 50, cy: 50, r: 50, fill: 'url(#dshmp-grad-body)' }),
                  GROOVE_RADII.map((radius) =>
                    h('circle', {
                      key: 'groove' + radius,
                      cx: 50,
                      cy: 50,
                      r: radius,
                      fill: 'none',
                      stroke: 'rgba(255,255,255,0.055)',
                      strokeWidth: 0.7,
                    }),
                  ),
                  h('circle', {
                    key: 'rim',
                    cx: 50,
                    cy: 50,
                    r: 49.2,
                    fill: 'none',
                    stroke: 'rgba(255,255,255,0.22)',
                    strokeWidth: 1.4,
                  }),
                  h('circle', { key: 'label', cx: 50, cy: 50, r: 17, fill: '#ffffff' }),
                  h(
                    'g',
                    { key: 'bow', transform: 'translate(38.5 38.5) scale(0.46)' },
                    h('path', {
                      key: 'loopLeft',
                      d: 'M25 25 C21 19 15 12.8 9 13.4 C6.4 13.8 5.4 36.2 9 36.6 C15 37.2 21 31 25 25 Z',
                      fill: '#000000',
                    }),
                    h('path', {
                      key: 'loopRight',
                      d: 'M25 25 C29 19 35 12.8 41 13.4 C43.6 13.8 44.6 36.2 41 36.6 C35 37.2 29 31 25 25 Z',
                      fill: '#000000',
                    }),
                    h('rect', { key: 'knot', x: 22.6, y: 19.6, width: 4.8, height: 10.8, rx: 2.4, fill: '#000000' }),
                  ),
                ),
                // Static specular highlight: the light source does not spin with
                // the record, so it stays pinned to the upper-right of the disc.
                h('circle', {
                  key: 'sheen',
                  cx: 50,
                  cy: 50,
                  r: 50,
                  fill: 'url(#dshmp-grad-sheen)',
                  pointerEvents: 'none',
                }),
              ),
              h(
                'div',
                { key: 'controls', className: 'dshmp-controls' },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'dshmp-btn dshmp-btn-side',
                    title: t('prev'),
                    'aria-label': t('prev'),
                    tabIndex: phase === 'bar' ? 0 : -1,
                    onPointerDown: stopPointer,
                    onClick: (event) => {
                      event.stopPropagation()
                      step(-1)
                    },
                  },
                  iconPrev(16),
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'dshmp-btn dshmp-btn-main',
                    title: playing ? t('pause') : t('play'),
                    'aria-label': playing ? t('pause') : t('play'),
                    tabIndex: phase === 'bar' ? 0 : -1,
                    onPointerDown: stopPointer,
                    onClick: togglePlay,
                  },
                  playing ? iconPause(22) : iconPlay(22),
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'dshmp-btn dshmp-btn-side',
                    title: t('next'),
                    'aria-label': t('next'),
                    tabIndex: phase === 'bar' ? 0 : -1,
                    onPointerDown: stopPointer,
                    onClick: (event) => {
                      event.stopPropagation()
                      step(1)
                    },
                  },
                  iconNext(16),
                ),
              ),
              h(
                'div',
                {
                  key: 'progress',
                  className: 'dshmp-progress' + (scrub === null ? '' : ' dshmp-scrubbing'),
                  onPointerDown: beginSeek,
                  onPointerMove: moveSeek,
                  onPointerUp: endSeek,
                  onPointerCancel: endSeek,
                },
                h('span', { style: { width: Math.round(displayedRatio * 100) + '%' } }),
              ),
            ),
            h('audio', {
              key: 'audio',
              ref: audioRef,
              className: 'dshmp-audio',
              preload: 'auto',
              onTimeUpdate: handleTimeUpdate,
              onLoadedMetadata: handleLoadedMetadata,
              onDurationChange: handleLoadedMetadata,
              onEnded: handleEnded,
              onPlay: () => setPlaying(true),
              onPause: () => {
                if (mutePauseRef.current) return
                setPlaying(false)
              },
            }),
            h(
              'div',
              {
                key: 'gear',
                className: 'dshmp-gear-anchor',
                'data-dshmp-surface': 'gear',
                style: {
                  width: GEAR,
                  height: GEAR,
                  transform: 'translate3d(' + gearX + 'px,' + gearY + 'px,0)',
                  transition: dragging ? 'none' : 'transform .46s cubic-bezier(.22,.68,.24,1)',
                },
              },
              h(
                'button',
                {
                  type: 'button',
                  className: gearClass,
                  style: { width: GEAR, height: GEAR },
                  title: t('gear'),
                  'aria-label': t('gear'),
                  'aria-expanded': panelOpen ? 'true' : 'false',
                  tabIndex: phase === 'bar' ? 0 : -1,
                  onPointerEnter: revealModes,
                  onPointerLeave: hideModesSoon,
                  onFocus: revealModes,
                  onBlur: hideModesSoon,
                  onClick: (event) => {
                    event.stopPropagation()
                    setPanelOpen((value) => !value)
                  },
                },
                iconGear(20),
                gearRing(),
              ),
              // Playback modes slide out of the gear: repeat-one to the left,
              // shuffle to the right. The selection is sticky and never resets.
              h(
                'div',
                {
                  key: 'mode-repeat',
                  className:
                    'dshmp-mode-wrap dshmp-mode-wrap-left dshmp-mode-repeat' +
                    (modeBar ? ' dshmp-mode-on' : '') +
                    (mode === 'repeat' ? ' dshmp-selected' : ''),
                  onPointerEnter: revealModes,
                  onPointerLeave: hideModesSoon,
                },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'dshmp-mode',
                    tabIndex: modeBar ? 0 : -1,
                    title: t('repeat'),
                    'aria-label': t('repeat'),
                    'aria-pressed': mode === 'repeat' ? 'true' : 'false',
                    onClick: (event) => {
                      event.stopPropagation()
                      chooseMode('repeat')
                    },
                  },
                  iconRepeat(22),
                ),
                modeRing('repeat', mode === 'repeat'),
              ),
              h(
                'div',
                {
                  key: 'mode-shuffle',
                  className:
                    'dshmp-mode-wrap dshmp-mode-wrap-right dshmp-mode-shuffle' +
                    (modeBar ? ' dshmp-mode-on' : '') +
                    (mode === 'shuffle' ? ' dshmp-selected' : ''),
                  onPointerEnter: revealModes,
                  onPointerLeave: hideModesSoon,
                },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'dshmp-mode',
                    tabIndex: modeBar ? 0 : -1,
                    title: t('shuffle'),
                    'aria-label': t('shuffle'),
                    'aria-pressed': mode === 'shuffle' ? 'true' : 'false',
                    onClick: (event) => {
                      event.stopPropagation()
                      chooseMode('shuffle')
                    },
                  },
                  iconShuffle(22),
                ),
                modeRing('shuffle', mode === 'shuffle'),
              ),
            ),
            h(
              'div',
              {
                key: 'panel',
                className: 'dshmp-panel' + (panelOpen ? ' dshmp-visible' : ''),
                style: panelStyle,
                role: 'dialog',
                'data-dshmp-surface': 'panel',
                'aria-label': t('panelTitle'),
                'aria-hidden': panelOpen ? 'false' : 'true',
              },
              h(
                'div',
                { className: 'dshmp-head' },
                h(
                  'div',
                  { className: 'dshmp-headtext' },
                  h('div', { className: 'dshmp-title' }, t('panelTitle')),
                  h('div', { className: 'dshmp-sub' }, t('panelSub')),
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'dshmp-iconbtn',
                    title: t('close'),
                    'aria-label': t('close'),
                    onClick: () => setPanelOpen(false),
                  },
                  iconClose(13),
                ),
              ),
              h(
                'div',
                { className: 'dshmp-now' },
                h('span', { className: 'dshmp-now-label' }, tempTrack ? t('tempBadge') : t('playingNow')),
                h('span', { className: 'dshmp-now-title' }, currentTitle || '—'),
              ),
              h(
                'div',
                { className: 'dshmp-sect' },
                h(
                  'div',
                  { className: 'dshmp-time' },
                  h('span', { className: 'dshmp-time-label' }, formatTime(displayedTime)),
                  h(
                    'div',
                    {
                      className: 'dshmp-seek' + (scrub === null ? '' : ' dshmp-scrubbing'),
                      onPointerDown: beginSeek,
                      onPointerMove: moveSeek,
                      onPointerUp: endSeek,
                      onPointerCancel: endSeek,
                    },
                    h('span', {
                      className: 'dshmp-seek-fill',
                      style: { width: Math.round(displayedRatio * 100) + '%' },
                    }),
                    h('span', {
                      className: 'dshmp-seek-knob',
                      style: { left: Math.round(displayedRatio * 100) + '%' },
                    }),
                  ),
                  h('span', { className: 'dshmp-time-label' }, formatTime(duration)),
                ),
                h(
                  'div',
                  { className: 'dshmp-volume' },
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'dshmp-iconbtn',
                      title: muted ? t('unmute') : t('mute'),
                      'aria-label': muted ? t('unmute') : t('mute'),
                      onClick: toggleMute,
                    },
                    iconVolume(volumeRatio),
                  ),
                  h(
                    'div',
                    {
                      className: 'dshmp-volume-track',
                      onPointerDown: beginVolume,
                      onPointerMove: moveVolume,
                      onPointerUp: endVolume,
                      onPointerCancel: endVolume,
                    },
                    h('span', {
                      className: 'dshmp-seek-fill',
                      style: { width: Math.round(volumeRatio * 100) + '%' },
                    }),
                    h('span', {
                      className: 'dshmp-seek-knob',
                      style: { left: Math.round(volumeRatio * 100) + '%' },
                    }),
                  ),
                  h('span', { className: 'dshmp-time-label' }, Math.round(volumeRatio * 100) + '%'),
                ),
              ),
              h(
                'div',
                { className: 'dshmp-sect' },
                h(
                  'div',
                  { className: 'dshmp-label-row' },
                  h('span', { className: 'dshmp-sect-label' }, t('playlistSection')),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'dshmp-help-btn',
                      title: t('playlistHelp'),
                      'aria-label': t('playlistHelp'),
                      'aria-expanded': helpOpen ? 'true' : 'false',
                      onClick: () => setHelpOpen((value) => !value),
                    },
                    '?',
                  ),
                ),
                helpOpen
                  ? h(
                      'ol',
                      { className: 'dshmp-help' },
                      h('li', null, t('helpStep1')),
                      h('li', null, t('helpStep2')),
                      h('li', null, t('helpStep3')),
                      h('li', null, t('helpStep4')),
                      h(
                        'li',
                        null,
                        t('helpStep5'),
                        h('div', { className: 'dshmp-help-example' }, t('helpExample')),
                      ),
                      h(
                        'li',
                        null,
                        t('helpStep6'),
                        h('span', { className: 'dshmp-help-face' }, ' (∠・ω< )⌒☆'),
                      ),
                    )
                  : null,
                h(
                  'form',
                  { onSubmit: submitPlaylist },
                  h(
                    'div',
                    { className: 'dshmp-field' },
                    iconLink(14),
                    h('input', {
                      className: 'dshmp-input',
                      type: 'text',
                      value: playlist,
                      placeholder: t('playlistPlaceholder'),
                      spellCheck: false,
                      enterKeyHint: 'go',
                      onChange: (event) => setPlaylist(event.target.value),
                    }),
                    h('button', { type: 'submit', className: 'dshmp-inline-btn' }, t('load')),
                  ),
                ),
                h(
                  'div',
                  { className: 'dshmp-note' },
                  playlistTitle ? playlistTitle + ' · ' + tracks.length : t('noPlaylist'),
                ),
                tracks.length
                  ? h(
                      'div',
                      { className: 'dshmp-list' },
                      tracks.map((track, index) =>
                        h(
                          'button',
                          {
                            key: 'p' + track.bvid + ':' + index,
                            type: 'button',
                            className:
                              'dshmp-track' + (index === currentIndex && !tempTrack ? ' dshmp-current' : ''),
                            title: track.title,
                            onClick: () => playTrack(track, index, false),
                          },
                          h('span', { className: 'dshmp-track-title' }, track.title),
                          h('span', { className: 'dshmp-track-dur' }, formatTime(track.duration)),
                        ),
                      ),
                    )
                  : null,
                hasMore
                  ? h(
                      'button',
                      {
                        type: 'button',
                        className: 'dshmp-pill',
                        onClick: () => loadPlaylist(playlist, playlistPage + 1),
                      },
                      t('loadMore'),
                    )
                  : null,
              ),
              h(
                'div',
                { className: 'dshmp-sect' },
                h('div', { className: 'dshmp-sect-label' }, t('searchSection')),
                h(
                  'form',
                  { onSubmit: submitSearch },
                  h(
                    'div',
                    { className: 'dshmp-field' },
                    iconSearch(14),
                    h('input', {
                      className: 'dshmp-input',
                      type: 'text',
                      value: search,
                      placeholder: t('searchPlaceholder'),
                      spellCheck: false,
                      enterKeyHint: 'search',
                      onChange: (event) => setSearch(event.target.value),
                    }),
                  ),
                ),
                results
                  ? results.length
                    ? h(
                        'div',
                        { className: 'dshmp-list' },
                        results.map((item, index) =>
                          h(
                            'button',
                            {
                              key: 's' + item.bvid + ':' + index,
                              type: 'button',
                              className:
                                'dshmp-track' +
                                (tempTrack && tempTrack.bvid === item.bvid ? ' dshmp-current' : ''),
                              title: item.title,
                              onClick: () => playTrack(item, -1, true),
                            },
                            h('span', { className: 'dshmp-track-title' }, item.title),
                            h('span', { className: 'dshmp-track-dur' }, formatTime(item.duration)),
                          ),
                        ),
                      )
                    : h('div', { className: 'dshmp-note' }, t('noResults'))
                  : h('div', { className: 'dshmp-note' }, t('searchHint')),
              ),

              h(
                'div',
                { className: 'dshmp-pills' },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'dshmp-pill' + (mode === 'repeat' ? ' dshmp-on' : ''),
                    'aria-pressed': mode === 'repeat' ? 'true' : 'false',
                    onClick: () => chooseMode('repeat'),
                  },
                  iconRepeat(13),
                  t('repeat'),
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'dshmp-pill' + (mode === 'shuffle' ? ' dshmp-on' : ''),
                    'aria-pressed': mode === 'shuffle' ? 'true' : 'false',
                    onClick: () => chooseMode('shuffle'),
                  },
                  iconShuffle(13),
                  t('shuffle'),
                ),
              ),
              h('div', { className: 'dshmp-msg' + (hint || busy ? ' dshmp-on' : '') }, busy || hint),
              h(
                'div',
                { className: 'dshmp-foot' },
                h('span', null, t('preview')),
                h('span', { className: 'dshmp-build' }, hostVersion ? 'v' + hostVersion : BUILD),
              ),
            ),
          ),
        )
      }
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const Player = createPlayer(ctx)
        ctx.slots.inject('shell.overlay', () =>
          ctx.slots.register({ name: 'shell.overlay', id: 'music-player', order: 20 }, Player),
        )
      },
    }
  },
})
