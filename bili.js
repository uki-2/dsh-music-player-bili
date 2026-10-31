/**
 * Bilibili API client for the music player's Host half.
 *
 * Pure Node (no cordis): everything here is exercised by dev/bili-module-test.mjs
 * against the real endpoints, so the module the plugin runs is the module that
 * was tested.
 *
 * Network responses are treated as untrusted data: only documented fields are
 * read, every string is coerced, and nothing from a response is evaluated.
 */
import { createHash } from 'node:crypto'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
const REFERER = 'https://www.bilibili.com/'

// Official WBI mixin-key permutation table.
const MIXIN_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38,
  41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36,
  20, 34, 44, 52,
]

const WBI_TTL = 10 * 60 * 1000
const AUDIO_TTL = 25 * 60 * 1000

function pickKeyName(url) {
  return String(url || '')
    .split('/')
    .pop()
    .split('.')[0]
}

function mixinKey(imgUrl, subUrl) {
  const raw = pickKeyName(imgUrl) + pickKeyName(subUrl)
  if (raw.length < 64) return ''
  return MIXIN_TAB.map((index) => raw[index])
    .join('')
    .slice(0, 32)
}

function stripTags(value) {
  return String(value == null ? '' : value)
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim()
}

function parseDuration(value) {
  const text = String(value == null ? '' : value)
  if (/^\d+$/.test(text)) return Number(text)
  const parts = text.split(':').map((part) => Number(part))
  if (parts.some((part) => !Number.isFinite(part))) return 0
  return parts.reduce((total, part) => total * 60 + part, 0)
}

function mediaIdFrom(input) {
  const text = String(input == null ? '' : input).trim()
  if (/^\d+$/.test(text)) return text
  const match = text.match(/ml(\d+)/) || text.match(/media_id=(\d+)/) || text.match(/fid=(\d+)/)
  return match ? match[1] : ''
}

function bvidFrom(input) {
  const match = String(input == null ? '' : input).match(/BV[0-9A-Za-z]{10}/)
  return match ? match[0] : ''
}

export function createBili(options = {}) {
  const jar = { ...(options.cookies || {}) }
  let onCookiesChange = typeof options.onCookiesChange === 'function' ? options.onCookiesChange : () => {}
  let wbi = null
  const cidCache = new Map()
  const audioCache = new Map()

  function cookieHeader() {
    return Object.entries(jar)
      .map(([name, value]) => name + '=' + value)
      .join('; ')
  }

  function absorbCookies(response) {
    let changed = false
    const lines = response.headers && typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : []
    for (const line of lines) {
      const pair = String(line).split(';')[0]
      const index = pair.indexOf('=')
      if (index <= 0) continue
      const name = pair.slice(0, index).trim()
      const value = pair.slice(index + 1).trim()
      if (!name) continue
      if (jar[name] !== value) {
        jar[name] = value
        changed = true
      }
    }
    if (changed) {
      try {
        onCookiesChange({ ...jar })
      } catch {
        /* persistence is best effort */
      }
    }
    return changed
  }

  async function request(url, init = {}) {
    const cookie = cookieHeader()
    const response = await fetch(url, {
      method: init.method || 'GET',
      headers: {
        'User-Agent': UA,
        Referer: REFERER,
        ...(cookie ? { Cookie: cookie } : {}),
        ...(init.headers || {}),
      },
      signal: init.signal || AbortSignal.timeout(20000),
      redirect: 'follow',
    })
    absorbCookies(response)
    return response
  }

  async function getJson(url, init) {
    const response = await request(url, init)
    const text = await response.text()
    try {
      return JSON.parse(text)
    } catch {
      return { code: -1, message: 'unparsable response' }
    }
  }

  /** Bilibili grey-lists cookie-less API clients with HTTP 412. */
  async function ensureFingerprint() {
    if (jar.buvid3) return
    try {
      const spi = await getJson('https://api.bilibili.com/x/frontend/finger/spi')
      if (spi && spi.data && spi.data.b_3) jar.buvid3 = spi.data.b_3
      if (spi && spi.data && spi.data.b_4) jar.buvid4 = spi.data.b_4
    } catch {
      /* fall through to the homepage */
    }
    try {
      const home = await request('https://www.bilibili.com/')
      await home.arrayBuffer().catch(() => null)
    } catch {
      /* best effort */
    }
    if (jar.buvid3) {
      try {
        onCookiesChange({ ...jar })
      } catch {
        /* ignore */
      }
    }
  }

  async function ensureWbi(force) {
    if (!force && wbi && Date.now() - wbi.at < WBI_TTL) return wbi
    await ensureFingerprint()
    const nav = await getJson('https://api.bilibili.com/x/web-interface/nav')
    const img = nav && nav.data && nav.data.wbi_img ? nav.data.wbi_img.img_url : ''
    const sub = nav && nav.data && nav.data.wbi_img ? nav.data.wbi_img.sub_url : ''
    const key = mixinKey(img, sub)
    if (!key) throw new Error('wbi keys unavailable')
    wbi = {
      key,
      at: Date.now(),
      loggedIn: Boolean(nav && nav.data && nav.data.isLogin),
      uname: nav && nav.data ? String(nav.data.uname || '') : '',
      mid: nav && nav.data ? String(nav.data.mid || '') : '',
    }
    return wbi
  }

  function signedQuery(params, key, wts) {
    const all = { ...params, wts }
    return Object.keys(all)
      .sort()
      .map((name) => {
        const value = String(all[name]).replace(/[!'()*]/g, '')
        return encodeURIComponent(name) + '=' + encodeURIComponent(value)
      })
      .join('&')
  }

  async function wbiUrl(path, params) {
    const keys = await ensureWbi()
    const wts = Math.floor(Date.now() / 1000)
    const query = signedQuery(params, keys.key, wts)
    const wRid = createHash('md5')
      .update(query + keys.key)
      .digest('hex')
    return 'https://api.bilibili.com' + path + '?' + query + '&w_rid=' + wRid
  }

  async function session() {
    const keys = await ensureWbi()
    return {
      loggedIn: Boolean(keys.loggedIn),
      userName: keys.uname,
      mid: keys.mid,
      hasCookies: Boolean(jar.SESSDATA),
    }
  }

  async function setSessdata(raw) {
    const value = String(raw || '').trim().replace(/^SESSDATA=/i, '').replace(/;.*$/, '')
    if (!value) throw new Error('empty SESSDATA')
    jar.SESSDATA = value
    onCookiesChange({ ...jar })
    wbi = null
    const keys = await ensureWbi(true)
    if (!keys.loggedIn) {
      delete jar.SESSDATA
      onCookiesChange({ ...jar })
      wbi = null
      throw new Error('login rejected: SESSDATA is invalid or expired')
    }
    return { loggedIn: true, userName: keys.uname, mid: keys.mid }
  }

  function logout() {
    for (const name of ['SESSDATA', 'bili_jct', 'DedeUserID', 'DedeUserID__ckMd5', 'sid']) delete jar[name]
    onCookiesChange({ ...jar })
    wbi = null
    return { loggedIn: false }
  }

  function mapFavItem(item) {
    return {
      id: String(item.id || ''),
      bvid: bvidFrom(item.bvid),
      title: stripTags(item.title),
      author: stripTags(item.upper && item.upper.name),
      cover: String(item.cover || ''),
      duration: parseDuration(item.duration),
    }
  }

  async function favList(mediaIdInput, page = 1) {
    const mediaId = mediaIdFrom(mediaIdInput)
    if (!mediaId) throw new Error('playlist link or media id required')
    await ensureFingerprint()
    const pn = Math.max(1, Math.min(50, Number(page) || 1))
    // ps must stay within 1..20; the folder endpoint rejects larger pages.
    const url =
      'https://api.bilibili.com/x/v3/fav/resource/list?media_id=' +
      encodeURIComponent(mediaId) +
      '&pn=' +
      pn +
      '&ps=20&platform=web&order=mtime&type=0&tid=0'
    const body = await getJson(url)
    if (!body || body.code !== 0) {
      const message = body && body.message ? String(body.message) : 'playlist unavailable'
      throw new Error(message)
    }
    const data = body.data || {}
    const info = data.info || {}
    const medias = Array.isArray(data.medias) ? data.medias : []
    return {
      mediaId,
      title: stripTags(info.title),
      count: Number(info.media_count) || medias.length,
      items: medias
        .filter((item) => item && (item.type === 2 || item.bvid))
        .map(mapFavItem)
        .filter((item) => item.bvid),
      hasMore: Boolean(data.has_more),
      page: pn,
    }
  }

  async function search(keyword) {
    const word = String(keyword || '').trim()
    if (!word) throw new Error('keyword required')
    const url = await wbiUrl('/x/web-interface/wbi/search/type', {
      search_type: 'video',
      keyword: word,
      page: 1,
      page_size: 20,
    })
    const body = await getJson(url)
    if (!body || body.code !== 0) {
      const message = body && body.message ? String(body.message) : 'search failed'
      throw new Error(message)
    }
    const result = (body.data && Array.isArray(body.data.result) ? body.data.result : [])
      .filter((item) => item && (item.bvid || item.arcurl))
      .slice(0, 20)
    return {
      keyword: word,
      items: result.map((item) => ({
        bvid: bvidFrom(item.bvid || item.arcurl),
        title: stripTags(item.title),
        author: stripTags(item.author),
        cover: String(item.pic || ''),
        duration: parseDuration(item.duration),
      })).filter((item) => item.bvid),
    }
  }

  async function resolveCid(bvidInput) {
    const bvid = bvidFrom(bvidInput)
    if (!bvid) throw new Error('invalid bvid')
    const cached = cidCache.get(bvid)
    if (cached && Date.now() - cached.at < 60 * 60 * 1000) return cached
    await ensureFingerprint()
    const body = await getJson('https://api.bilibili.com/x/web-interface/view?bvid=' + bvid)
    if (!body || body.code !== 0 || !body.data) {
      throw new Error(body && body.message ? String(body.message) : 'video info unavailable')
    }
    const pages = Array.isArray(body.data.pages) ? body.data.pages : []
    const entry = {
      bvid,
      cid: String(body.data.cid || (pages[0] && pages[0].cid) || ''),
      title: stripTags(body.data.title),
      author: stripTags(body.data.owner && body.data.owner.name),
      duration: Number(body.data.duration) || 0,
      at: Date.now(),
    }
    if (!entry.cid) throw new Error('video has no cid')
    cidCache.set(bvid, entry)
    return entry
  }

  async function resolveAudio(bvidInput) {
    const bvid = bvidFrom(bvidInput)
    if (!bvid) throw new Error('invalid bvid')
    const cached = audioCache.get(bvid)
    if (cached && Date.now() - cached.at < AUDIO_TTL) return cached
    const info = await resolveCid(bvid)
    const url = await wbiUrl('/x/player/wbi/playurl', {
      bvid,
      cid: info.cid,
      fnval: 16,
      fnver: 0,
      fourk: 1,
    })
    const body = await getJson(url)
    if (!body || body.code !== 0 || !body.data) {
      throw new Error(body && body.message ? String(body.message) : 'stream unavailable')
    }
    const dash = body.data.dash || {}
    const streams = Array.isArray(dash.audio) ? dash.audio.slice() : []
    streams.sort((left, right) => (Number(right.bandwidth) || 0) - (Number(left.bandwidth) || 0))
    const best = streams[0]
    const streamUrl = best ? best.baseUrl || best.base_url || (best.backupUrl && best.backupUrl[0]) : ''
    if (!streamUrl) throw new Error('no audio stream for this video')
    const entry = {
      bvid,
      cid: info.cid,
      title: info.title,
      duration: info.duration,
      streamId: Number(best.id) || 0,
      bandwidth: Number(best.bandwidth) || 0,
      url: String(streamUrl),
      backup: Array.isArray(best.backupUrl) ? best.backupUrl.map(String) : [],
      at: Date.now(),
    }
    audioCache.set(bvid, entry)
    return entry
  }

  /** Invalidate the cached media URL so the next request re-signs it. */
  function invalidateAudio(bvidInput) {
    audioCache.delete(bvidFrom(bvidInput))
  }

  function fetchAudio(url, range, signal) {
    return request(String(url), {
      headers: range ? { Range: String(range) } : {},
      signal,
    })
  }

  return {
    session,
    setSessdata,
    logout,
    favList,
    search,
    resolveCid,
    resolveAudio,
    invalidateAudio,
    fetchAudio,
    mediaIdFrom,
    bvidFrom,
    stripTags,
  }
}
