/**
 * Probe the Bilibili pipeline exactly as the Host half will run it:
 * WBI signing -> search / fav list / view / playurl -> audio CDN fetch.
 * Prints facts only; network responses are treated as data, never executed.
 */
import { createHash } from 'node:crypto'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
const BASE_HEADERS = { 'User-Agent': UA, Referer: 'https://www.bilibili.com/' }

// Cookie bootstrap: Bilibili greylists cookie-less API clients (412) and expects
// buvid3/buvid4 from the fingerprint endpoint plus the homepage cookies.
const cookieJar = {}
function cookieHeader() {
  return Object.entries(cookieJar)
    .map(([name, value]) => name + '=' + value)
    .join('; ')
}

// Official mixin-key permutation table.
const MIXIN_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38,
  41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36,
  20, 34, 44, 52,
]

function mixinKey(imgUrl, subUrl) {
  const pick = (url) => String(url).split('/').pop().split('.')[0]
  const raw = pick(imgUrl) + pick(subUrl)
  return MIXIN_TAB.map((index) => raw[index]).join('').slice(0, 32)
}

function signQuery(params, key, wts) {
  const all = { ...params, wts }
  return Object.keys(all)
    .sort()
    .map(
      (name) =>
        encodeURIComponent(name) +
        '=' +
        encodeURIComponent(String(all[name]).replace(/[!'()*]/g, '')),
    )
    .join('&')
}

function withWbi(path, params, key) {
  const wts = Math.floor(Date.now() / 1000)
  const query = signQuery(params, key, wts)
  const wRid = createHash('md5').update(query + key).digest('hex')
  return 'https://api.bilibili.com' + path + '?' + query + '&w_rid=' + wRid
}

async function getJson(url, extraHeaders) {
  const cookie = cookieHeader()
  const response = await fetch(url, {
    headers: { ...BASE_HEADERS, ...(cookie ? { Cookie: cookie } : {}), ...extraHeaders },
    signal: AbortSignal.timeout(20000),
  })
  const text = await response.text()
  let body = null
  try {
    body = JSON.parse(text)
  } catch {
    body = { parseError: true, head: text.slice(0, 120) }
  }
  return { status: response.status, body }
}

const nav = await getJson('https://api.bilibili.com/x/web-interface/nav')
const img = nav.body?.data?.wbi_img?.img_url
const sub = nav.body?.data?.wbi_img?.sub_url
const key = mixinKey(img, sub)
console.log('nav', nav.status, 'code=' + nav.body?.code, 'mixinKey=' + key)

async function bootstrapCookies() {
  try {
    const spi = await getJson('https://api.bilibili.com/x/frontend/finger/spi')
    if (spi.body?.data?.b_3) cookieJar.buvid3 = spi.body.data.b_3
    if (spi.body?.data?.b_4) cookieJar.buvid4 = spi.body.data.b_4
    const home = await fetch('https://www.bilibili.com/', {
      headers: BASE_HEADERS,
      signal: AbortSignal.timeout(20000),
    })
    for (const line of home.headers.getSetCookie?.() || []) {
      const pair = line.split(';')[0]
      const index = pair.indexOf('=')
      if (index > 0) cookieJar[pair.slice(0, index)] = pair.slice(index + 1)
    }
    console.log('cookies', Object.keys(cookieJar).join(','), 'home=' + home.status)
  } catch (error) {
    console.log('cookies FAILED', error.message)
  }
}
await bootstrapCookies()

// 1. WBI-signed search

// 1. WBI-signed search
{
  const url = withWbi('/x/web-interface/wbi/search/type', { search_type: 'video', keyword: 'Old Memory', page: 1 }, key)
  const res = await getJson(url)
  const first = res.body?.data?.result?.[0]
  console.log(
    'search',
    res.status,
    'code=' + res.body?.code,
    'hits=' + (res.body?.data?.numResults ?? 0),
    first ? 'first=' + first.bvid + ' | ' + String(first.title).replace(/<[^>]+>/g, '').slice(0, 40) : 'no result',
  )
}

// 2. Favorite folder (the user's medialist link)
let bvid = null
{
  const url =
    'https://api.bilibili.com/x/v3/fav/resource/list?media_id=4345449283&pn=1&ps=20&platform=web&order=mtime&type=0&tid=0'
  const res = await getJson(url)
  const medias = res.body?.data?.medias || []
  bvid = medias[0]?.bvid || null
  console.log('fav', res.status, 'code=' + res.body?.code, 'title=' + res.body?.data?.info?.title, 'items=' + medias.length)
  for (const item of medias.slice(0, 3)) {
    console.log('   -', item.bvid, item.duration + 's', String(item.title).slice(0, 34))
  }
}

// 3. View -> cid
let cid = null
if (bvid) {
  const res = await getJson('https://api.bilibili.com/x/web-interface/view?bvid=' + bvid)
  cid = res.body?.data?.cid || res.body?.data?.pages?.[0]?.cid || null
  console.log('view', res.status, 'code=' + res.body?.code, 'cid=' + cid, 'title=' + String(res.body?.data?.title).slice(0, 30))
}

// 4. Playurl (WBI) -> dash audio list
let audioUrl = null
if (bvid && cid) {
  const url = withWbi('/x/player/wbi/playurl', { bvid, cid, fnval: 16, fourk: 1, fnver: 0 }, key)
  const res = await getJson(url)
  const dash = res.body?.data?.dash
  const audios = dash?.audio || []
  audioUrl = audios[0]?.baseUrl || audios[0]?.base_url || null
  console.log(
    'playurl',
    res.status,
    'code=' + res.body?.code,
    'dash=' + Boolean(dash),
    'audioStreams=' + audios.length,
    audios[0] ? 'firstId=' + audios[0].id + ' bandwidth=' + audios[0].bandwidth : '',
  )
  if (res.body?.data?.durl) console.log('   durl fallback =', res.body.data.durl.length)
}

// 5. Audio CDN: does it need Referer, and does Range work?
if (audioUrl) {
  for (const [label, extra] of [
    ['with referer+range', { Referer: 'https://www.bilibili.com/', Range: 'bytes=0-2047' }],
    ['no referer', { Range: 'bytes=0-2047' }],
  ]) {
    try {
      const response = await fetch(audioUrl, { headers: { 'User-Agent': UA, ...extra }, signal: AbortSignal.timeout(20000) })
      const chunk = await response.arrayBuffer()
      console.log(
        'cdn',
        label,
        'status=' + response.status,
        'type=' + response.headers.get('content-type'),
        'len=' + chunk.byteLength,
        'accept-ranges=' + response.headers.get('accept-ranges'),
        'content-range=' + response.headers.get('content-range'),
      )
    } catch (error) {
      console.log('cdn', label, 'FAILED', error.message)
    }
  }
}
