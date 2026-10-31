/**
 * Exercises the shipped Host module (dsh-plugin/bili.js) against the real
 * Bilibili endpoints. Responses are data only.
 */
import { createBili } from '../bili.js'

const results = []
function check(name, ok, detail) {
  results.push({ name, ok, detail })
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' :: ' + detail : ''))
}

const cookieWrites = []
const bili = createBili({ onCookiesChange: (jar) => cookieWrites.push(Object.keys(jar)) })

const session = await bili.session()
check('session shape', typeof session.loggedIn === 'boolean', JSON.stringify(session))

const link = 'https://www.bilibili.com/medialist/detail/ml4345449283?spm_id_from=333.1387.list.card_medialist.click'
check('parse media id from link', bili.mediaIdFrom(link) === '4345449283', bili.mediaIdFrom(link))

const fav = await bili.favList(link)
check('playlist loads', fav.items.length > 0, fav.title + ' / ' + fav.count + ' items')
check('playlist item shape', Boolean(fav.items[0].bvid && fav.items[0].title && fav.items[0].duration > 0), JSON.stringify(fav.items[0]))
check('cookie jar persisted', cookieWrites.length > 0, cookieWrites.map((keys) => keys.join('+')).join(' | '))

const found = await bili.search('Old Memory')
check('search returns items', found.items.length > 0, found.items.length + ' hits; first=' + found.items[0].bvid + ' ' + found.items[0].title.slice(0, 24))

const bvid = fav.items[0].bvid
const audio = await bili.resolveAudio(bvid)
check('audio stream resolved', Boolean(audio.url), 'id=' + audio.streamId + ' bw=' + audio.bandwidth + ' cid=' + audio.cid)

const upstream = await bili.fetchAudio(audio.url, 'bytes=0-2047')
const bytes = await upstream.arrayBuffer()
check(
  'range proxy upstream',
  upstream.status === 206 && bytes.byteLength === 2048,
  'status=' + upstream.status + ' type=' + upstream.headers.get('content-type'),
)

const again = await bili.resolveAudio(bvid)
check('audio url cached', again.url === audio.url && again.at === audio.at, 'no re-sign within TTL')

let rejected = false
try {
  await bili.favList('https://www.bilibili.com/medialist/detail/ml1')
} catch (error) {
  rejected = true
  check('bad playlist reports a message', Boolean(error.message), error.message)
}
if (!rejected) check('bad playlist reports a message', false, 'did not throw')

let invalidLogin = false
try {
  await bili.setSessdata('this-is-not-a-valid-session')
} catch (error) {
  invalidLogin = true
  check('invalid SESSDATA rejected', /SESSDATA/i.test(error.message), error.message)
}
if (!invalidLogin) check('invalid SESSDATA rejected', false, 'accepted a bogus cookie')

const failed = results.filter((entry) => !entry.ok)
console.log('\n' + (results.length - failed.length) + '/' + results.length + ' checks passed')
if (failed.length) process.exit(1)
