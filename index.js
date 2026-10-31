/**
 * Host half of the music player: Bilibili access plus the local HTTP routes the
 * Client half calls.
 *
 * Routes live under /dsh-music: JSON endpoints return {ok:true,...} or
 * {ok:false,error}, and /dsh-music/stream proxies audio bytes with Range
 * passthrough so the <audio> element can seek.
 *
 * Player settings (playlist link, playback mode, volume, window position) live
 * in this package's own data directory, so they survive a restart, a changed
 * GUI port, or a profile reinstall.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { createBili } from './bili.js'

export const inject = ['webServer']

const API = '/dsh-music'
const PACKAGE_DIR = fileURLToPath(new URL('.', import.meta.url))

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  })
  res.end(body)
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = ''
    req.on('data', (chunk) => {
      data += chunk
      if (data.length > 200000) {
        data = ''
        req.destroy()
      }
    })
    req.on('end', () => resolve(data))
    req.on('error', () => resolve(''))
  })
}

export function apply(ctx) {
  // Read on every request: bumping package.json shows up after a page refresh,
  // with no reinstall.
  const readVersion = () => {
    try {
      return String(JSON.parse(readFileSync(join(PACKAGE_DIR, 'package.json'), 'utf8')).version || '')
    } catch {
      return ''
    }
  }

  const dir = join(homedir(), '.dsh', 'dsh-music-player')
  const statePath = join(dir, 'state.json')
  let state = { cookies: {} }
  try {
    const parsed = JSON.parse(readFileSync(statePath, 'utf8'))
    if (parsed && typeof parsed === 'object') state = { ...state, ...parsed }
  } catch {
    /* first run */
  }
  const persist = () => {
    try {
      mkdirSync(dir, { recursive: true })
      writeFileSync(statePath, JSON.stringify(state, null, 2))
    } catch {
      /* best effort */
    }
  }
  const bili = createBili({
    cookies: state.cookies || {},
    onCookiesChange: (jar) => {
      state.cookies = jar
      persist()
    },
  })

  const param = (req, name) => {
    try {
      return new URL(req.url, 'http://127.0.0.1').searchParams.get(name) || ''
    } catch {
      return ''
    }
  }

  // Player settings live inside the package, next to this file.
  const settingsDir = join(PACKAGE_DIR, 'data')
  const settingsPath = join(settingsDir, 'settings.json')
  let settings = {}
  try {
    const parsed = JSON.parse(readFileSync(settingsPath, 'utf8'))
    if (parsed && typeof parsed === 'object') settings = parsed
  } catch {
    /* first run */
  }
  const persistSettings = () => {
    try {
      mkdirSync(settingsDir, { recursive: true })
      writeFileSync(settingsPath, JSON.stringify(settings, null, 2))
    } catch {
      /* best effort */
    }
  }

  async function handleSettings(req, res) {
    if (req.method === 'POST' || req.method === 'PUT') {
      const raw = await readBody(req)
      let patch = null
      try {
        patch = JSON.parse(raw)
      } catch {
        patch = null
      }
      if (!patch || typeof patch !== 'object') {
        return sendJson(res, 400, { ok: false, error: 'bad json' })
      }
      if (typeof patch.link === 'string') settings.link = patch.link.slice(0, 2000)
      if (patch.mode === 'repeat' || patch.mode === 'shuffle') settings.mode = patch.mode
      if (typeof patch.volume === 'number' && patch.volume >= 0 && patch.volume <= 1) {
        settings.volume = Math.round(patch.volume * 1000) / 1000
      }
      if (
        patch.position &&
        Number.isFinite(patch.position.x) &&
        Number.isFinite(patch.position.y)
      ) {
        settings.position = { x: Math.round(patch.position.x), y: Math.round(patch.position.y) }
      }
      persistSettings()
      return sendJson(res, 200, { ok: true, version: readVersion(), settings })
    }
    return sendJson(res, 200, { ok: true, version: readVersion(), settings })
  }

  async function handlePlaylist(req, res) {
    const link = param(req, 'link')
    const page = Number(param(req, 'page')) || 1
    try {
      const list = await bili.favList(link, page)
      sendJson(res, 200, { ok: true, ...list })
    } catch (error) {
      sendJson(res, 502, { ok: false, error: String(error.message || error) })
    }
  }

  async function handleSearch(req, res) {
    const keyword = param(req, 'q')
    try {
      const found = await bili.search(keyword)
      sendJson(res, 200, { ok: true, ...found })
    } catch (error) {
      sendJson(res, 502, { ok: false, error: String(error.message || error) })
    }
  }

  async function handleTrack(req, res) {
    try {
      const info = await bili.resolveCid(param(req, 'bvid'))
      sendJson(res, 200, { ok: true, ...info })
    } catch (error) {
      sendJson(res, 502, { ok: false, error: String(error.message || error) })
    }
  }

  async function handleStream(req, res) {
    const bvid = param(req, 'bvid')
    const controller = new AbortController()
    req.on('close', () => controller.abort())
    const range = req.headers.range
    try {
      let audio = await bili.resolveAudio(bvid)
      let upstream = await bili.fetchAudio(audio.url, range, controller.signal)
      // Media URLs expire; a 403 means the cache is stale.
      if (upstream.status === 403 || upstream.status === 401) {
        bili.invalidateAudio(bvid)
        audio = await bili.resolveAudio(bvid)
        upstream = await bili.fetchAudio(audio.url, range, controller.signal)
      }
      if (upstream.status >= 400) {
        sendJson(res, upstream.status === 403 ? 502 : upstream.status, {
          ok: false,
          error: 'upstream ' + upstream.status,
        })
        return
      }
      const type = upstream.headers.get('content-type') || ''
      const headers = {
        'content-type': /video\//.test(type) ? 'audio/mp4' : type || 'audio/mp4',
        'accept-ranges': 'bytes',
        'cache-control': 'no-store',
      }
      for (const name of ['content-length', 'content-range']) {
        const value = upstream.headers.get(name)
        if (value) headers[name] = value
      }
      res.writeHead(upstream.status, headers)
      if (!upstream.body) {
        res.end()
        return
      }
      const stream = Readable.fromWeb(upstream.body)
      stream.on('error', () => {
        try {
          res.destroy()
        } catch {
          /* ignore */
        }
      })
      res.on('close', () => {
        try {
          stream.destroy()
        } catch {
          /* ignore */
        }
      })
      stream.pipe(res)
    } catch (error) {
      if (!res.headersSent) {
        sendJson(res, 502, { ok: false, error: String(error.message || error) })
      } else {
        try {
          res.end()
        } catch {
          /* ignore */
        }
      }
    }
  }

  const routes = [
    [API + '/api/settings', handleSettings],
    [API + '/api/playlist', handlePlaylist],
    [API + '/api/search', handleSearch],
    [API + '/api/track', handleTrack],
    [API + '/stream', handleStream],
  ]
  for (const [path, handler] of routes) {
    ctx.effect(() => ctx.webServer.register({ kind: 'exact', path, handler }))
  }
}
