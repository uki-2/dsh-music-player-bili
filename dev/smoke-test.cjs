/**
 * Headless smoke test for the Client half: no browser, no real React.
 * Stubs `window`, `document`, `localStorage` and a minimal hooks runtime so the
 * module can be loaded, its slot injection inspected, and the component tree
 * rendered at a few viewport sizes.
 */
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const source = fs.readFileSync(path.join(__dirname, '..', 'client.js'), 'utf8')
const failures = []

function makeStorage() {
  const map = new Map()
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
  }
}

function createRuntime(width, height, globals) {
  const hooks = []
  let cursor = 0
  const dirty = { value: false }

  const windowStub = {
    innerWidth: width,
    innerHeight: height,
    localStorage: makeStorage(),
    listeners: 0,
    addEventListener() {
      this.listeners += 1
    },
    removeEventListener() {
      this.listeners -= 1
    },
  }

  const React = {
    Fragment: 'Fragment',
    createElement(type, props, ...children) {
      return { type, props: props || {}, children: children.flat(Infinity) }
    },
    useState(initial) {
      const index = cursor++
      if (!(index in hooks)) hooks[index] = typeof initial === 'function' ? initial() : initial
      return [
        hooks[index],
        (next) => {
          hooks[index] = typeof next === 'function' ? next(hooks[index]) : next
          dirty.value = true
        },
      ]
    },
    useRef(initial) {
      const index = cursor++
      if (!(index in hooks)) hooks[index] = { current: initial }
      return hooks[index]
    },
    useEffect(effect) {
      const index = cursor++
      const first = !(index in hooks)
      hooks[index] = true
      if (first) effect()
    },
  }

  const sandbox = {
    window: windowStub,
    document: { documentElement: { lang: 'zh-CN' } },
    localStorage: windowStub.localStorage,
    setTimeout,
    clearTimeout,
    console,
    // The client uses standard web globals; a vm context does not provide them.
    URL,
    URLSearchParams,
    ...(globals || {}),
  }
  sandbox.window.document = sandbox.document
  windowStub.__ModuleLoader__ = {
    load(definition) {
      sandbox.__definition = definition
    },
  }

  vm.createContext(sandbox)
  vm.runInContext(source, sandbox, { filename: 'client.js' })

  const definition = sandbox.__definition
  // The client module id must match the package name (the loader keys on it), so
  // read it from package.json instead of hard-coding it here.
  const expectedId = JSON.parse(
    require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'package.json'), 'utf8'),
  ).name
  if (!definition || definition.id !== expectedId) {
    failures.push('module did not register under id ' + expectedId + ' (got ' + (definition && definition.id) + ')')
    return null
  }

  const factory = definition.factory
  const plugin = factory((name) => {
    if (name === 'react') return React
    throw new Error('unexpected require: ' + name)
  })
  return { plugin, React, hooks, sandbox, resetCursor: () => (cursor = 0), dirty }
}

function renderTree(runtime, component) {
  runtime.resetCursor()
  for (let attempt = 0; attempt < 6; attempt += 1) {
    runtime.dirty.value = false
    const tree = component()
    if (!runtime.dirty.value) return tree
  }
  throw new Error('render did not settle')
}

function walk(node, visit) {
  if (!node || typeof node !== 'object') return
  visit(node)
  if (Array.isArray(node.children)) node.children.forEach((child) => walk(child, visit))
}

function countByTag(tree, tag) {
  let count = 0
  walk(tree, (node) => {
    if (node.type === tag) count += 1
  })
  return count
}

function findNode(tree, predicate) {
  let found = null
  walk(tree, (node) => {
    if (!found && predicate(node)) found = node
  })
  return found
}

// ---------------------------------------------------------------- assertions
function checkSize(width, height) {
  const runtime = createRuntime(width, height)
  if (!runtime) return

  const injected = []
  const registered = []
  const ctx = {
    get: () => undefined,
    slots: {
      inject(key, callback) {
        injected.push(key)
        callback()
        return () => {}
      },
      register(options, component) {
        registered.push({ options, component })
        return () => {}
      },
    },
  }

  try {
    runtime.plugin.apply(ctx)
  } catch (error) {
    failures.push(width + 'x' + height + ' apply threw: ' + error.message)
    return
  }

  if (injected.length !== 1 || injected[0] !== 'shell.overlay') {
    failures.push(width + 'x' + height + ' injected ' + JSON.stringify(injected))
  }
  if (!registered.length) {
    failures.push(width + 'x' + height + ' registered nothing')
    return
  }
  const entry = registered[0].options
  if (entry.name !== 'shell.overlay' || entry.id !== 'music-player') {
    failures.push(width + 'x' + height + ' entry options ' + JSON.stringify(entry))
  }

  let tree
  try {
    tree = renderTree(runtime, registered[0].component)
  } catch (error) {
    failures.push(width + 'x' + height + ' render threw: ' + error.message)
    return
  }

  const stage = findNode(
    tree,
    (node) =>
      node.props &&
      String(node.props.className || '').indexOf('dshmp-stage') === 0 &&
      String(node.props.className).indexOf('dshmp-circle') !== -1,
  )
  if (!stage) {
    failures.push(width + 'x' + height + ' stage missing or not in circle phase')
    return
  }

  const style = stage.props.style
  const expectedDiameter = Math.round(Math.min(Math.max(Math.min(width, height) * 0 + width * 0.078, 58), 76))
  if (style.width !== expectedDiameter) {
    failures.push(width + 'x' + height + ' width ' + style.width + ' expected ' + expectedDiameter)
  }
  if (style.height !== expectedDiameter) {
    failures.push(width + 'x' + height + ' height ' + style.height)
  }

  const transform = /^translate3d\((-?[\d.]+)px,(-?[\d.]+)px,0\)$/.exec(style.transform)
  if (!transform) {
    failures.push(width + 'x' + height + ' bad transform ' + style.transform)
  } else {
    const x = Number(transform[1])
    const y = Number(transform[2])
    if (x < 14) failures.push(width + 'x' + height + ' position off-screen ' + x + ',' + y)
    if (y < 116) failures.push(width + 'x' + height + ' widget entered the reserved top band: y=' + y)
    if (x + style.width > width - 13) failures.push(width + 'x' + height + ' right overflow ' + (x + style.width))
    if (y + style.height > height - 13) failures.push(width + 'x' + height + ' bottom overflow ' + (y + style.height))
  }

  const buttons = countByTag(tree, 'button')
  // 3 transport + gear + close + repeat + shuffle + mute + 2 mode dots + help + 2 volume steps
  // (the draft row carries no button)
  if (buttons !== 13) failures.push(width + 'x' + height + ' button count ' + buttons + ' expected 13')

  const modeLeft = findNode(tree, (node) => node.props && String(node.props.className).indexOf('dshmp-mode-wrap-left') !== -1)
  const modeRight = findNode(tree, (node) => node.props && String(node.props.className).indexOf('dshmp-mode-wrap-right') !== -1)
  if (!modeLeft || !modeRight) failures.push(width + 'x' + height + ' playback-mode dots missing')
  else {
    const leftButton = findNode(modeLeft, (node) => node.type === 'button')
    const rightButton = findNode(modeRight, (node) => node.type === 'button')
    if (!leftButton || leftButton.props['aria-pressed'] !== 'false') {
      failures.push(width + 'x' + height + ' repeat should not be default')
    }
    if (!rightButton || rightButton.props['aria-pressed'] !== 'true') {
      failures.push(width + 'x' + height + ' shuffle should be the default mode')
    }
  }

  const styleNode = findNode(tree, (node) => node.type === 'style')
  const css = styleNode && styleNode.children ? String(styleNode.children.join('')) : ''

  // Every dot border is a real SVG circle; only the selected one carries the
  // running light along that same circle.
  const dots = [modeLeft, modeRight].filter(Boolean)
  const selectedDot = dots.find((dot) => String(dot.props.className).indexOf('dshmp-selected') !== -1)
  const plainDot = dots.find((dot) => String(dot.props.className).indexOf('dshmp-selected') === -1)
  if (!selectedDot || !plainDot) {
    failures.push(width + 'x' + height + ' one selected and one plain dot expected')
  } else {
    // Frames come from the buttons themselves now (same inset ring as the transport
    // buttons), so the three families cannot drift apart again.
    for (const name of ['dshmp-gear', 'dshmp-mode']) {
      const rule = new RegExp('^\\.' + name + '\\{([^}]*)\\}', 'm').exec(css)
      if (!rule || !/box-shadow:inset 0 0 0 1px var\(--dshmp-ring\)/.test(rule[1])) {
        failures.push(width + 'x' + height + ' ' + name + ' needs the shared inset ring')
      }
    }
    if (findNode(tree, (node) => node.props && node.props.className === 'dshmp-gear-ring')) {
      failures.push(width + 'x' + height + ' the gear must not carry a second frame')
    }
    // left-to-right light sweep for shuffle.
    if (findNode(tree, (node) => node.props && node.props.className === 'dshmp-ring-arc')) {
      failures.push(width + 'x' + height + ' the comet ring must be gone')
    }
    // Panel typography: two sizes, both taken from the DSH theme roles. Headings use
  // the conversation size (--dsh-content-font-size), everything else the code size
  // (--dsh-code-font-size); the theme writes both on <body>, so they inherit here.
  if (!/\.dshmp-panel\{--dshmp-h:var\(--dsh-content-font-size,16px\)\}/.test(css)) {
    failures.push(width + 'x' + height + ' the panel must derive its type scale from the DSH body size')
  }
  if (!/\.dshmp-panel,\.dshmp-panel \*\{font-size:calc\(var\(--dshmp-h\) - 3px\)\}/.test(css)) {
    failures.push(width + 'x' + height + ' body text must be heading minus 3px')
  }
  if (!/\.dshmp-panel \.dshmp-title,\.dshmp-panel \.dshmp-sect-label\{font-size:var\(--dshmp-h\)\}/.test(css)) {
    failures.push(width + 'x' + height + ' headings must use the heading size')
  }
  if (!/\.dshmp-panel \.dshmp-msg,[^{]*\{font-size:calc\(var\(--dshmp-h\) - 4px\)\}/.test(css)) {
    failures.push(width + 'x' + height + ' hints must be heading minus 4px')
  }
  // The bindings must come last, or the per-element sizes would win.
  const scaleRule = css.indexOf('--dshmp-h:')
  const lastPxSize = css.lastIndexOf('font-size:1')
  if (scaleRule < lastPxSize) {
    failures.push(width + 'x' + height + ' the type scale must be declared after the px sizes')
  }
  // Repeat-one is pulse only: no ripple, no travelling light.
    if (!/@keyframes dshmp-icon-pulse/.test(css)) {
      failures.push(width + 'x' + height + ' repeat pulse keyframes missing')
    }
    if (!/\.dshmp-mode-repeat\.dshmp-selected \.dshmp-mode>svg\{[^}]*animation:dshmp-icon-pulse/.test(css)) {
      failures.push(width + 'x' + height + ' the selected repeat dot must pulse')
    }
    if (/dshmp-march|dshmp-ripple/.test(css) || /dshmp-march|dshmp-ripple/.test(String(JSON.stringify(tree)))) {
      failures.push(width + 'x' + height + ' repeat motion must be the pulse only')
    }
    if (!/@keyframes dshmp-flow-x/.test(css)) {
      failures.push(width + 'x' + height + ' shuffle flow keyframes missing')
    }
    if (!/\.dshmp-mode-shuffle\.dshmp-selected \.dshmp-mode>svg\{[^}]*mask-image:linear-gradient/.test(css)) {
      failures.push(width + 'x' + height + ' shuffle icon must stream left to right')
    }
    // Repeat-one is drawn as two tracks with arrowheads plus a bold "1"; the old
    // circular arrow read as a refresh symbol. Guard the shape so it stays legible.
    const repeatGlyph = findNode(
      tree,
      (node) => node.type === 'path' && String(node.props.d || '').indexOf('M11 10h1v4') === 0,
    )
    if (!repeatGlyph) failures.push(width + 'x' + height + ' repeat-one glyph (the bold 1) missing')
    else if (repeatGlyph.props.strokeWidth < 2) {
      failures.push(width + 'x' + height + ' the repeat "1" must stay bolder than the tracks')
    }
    const repeatSvg = findNode(
      tree,
      (node) => node.type === 'svg' && (node.children || []).some((child) => child && child.props && child.props.key === 'trackUp'),
    )
    if (!repeatSvg) failures.push(width + 'x' + height + ' repeat tracks missing')
    else if ((repeatSvg.children || []).length !== 5) {
      failures.push(width + 'x' + height + ' repeat icon should be exactly 5 strokes')
    }
    const repeatDot = findNode(
      tree,
      (node) => node.props && String(node.props.className).indexOf('dshmp-mode-repeat') !== -1,
    )
    // Nothing but the pulse: no extra glyph layer was left behind.
    const strayLayers = findNode(
      tree,
      (node) => node.props && /dshmp-(march|ripple)/.test(String(node.props.className || '')),
    )
    if (strayLayers) failures.push(width + 'x' + height + ' repeat needs no extra motion layer')
  }


  // Percentage radii drift with the box: the three button families use fixed px
  // radii that match their SVG frames, so fill and border stay the same shape.
  for (const [cls, radius] of [['dshmp-btn-main', '15px'], ['dshmp-btn-side', '10px']]) {
    const rule = new RegExp('^\\.' + cls + '\\{([^}]*)\\}', 'm').exec(css)
    if (!rule || !new RegExp('border-radius:' + radius).test(rule[1])) {
      failures.push(width + 'x' + height + ' ' + cls + ' needs border-radius ' + radius)
    }
  }  const seek = findNode(tree, (node) => node.props && node.props.className === 'dshmp-seek')
  if (!seek) failures.push(width + 'x' + height + ' seek bar missing')
  else if (typeof seek.props.onPointerDown !== 'function') failures.push(width + 'x' + height + ' seek bar not interactive')
  const volumeTrack = findNode(tree, (node) => node.props && node.props.className === 'dshmp-volume-track')
  if (!volumeTrack) failures.push(width + 'x' + height + ' volume slider missing')
  else if (typeof volumeTrack.props.onPointerMove !== 'function') {
    failures.push(width + 'x' + height + ' volume slider not interactive')
  }
  const barProgress = findNode(tree, (node) => node.props && node.props.className === 'dshmp-progress')
  if (!barProgress || typeof barProgress.props.onPointerDown !== 'function') {
    failures.push(width + 'x' + height + ' bar progress is not draggable')
  }

  // The transport row is exactly three columns: no empty slot between them.
  const controls = findNode(tree, (node) => node.props && node.props.className === 'dshmp-controls')
  if (!controls) {
    failures.push(width + 'x' + height + ' controls row missing')
  } else {
    const transport = controls.children.filter((child) => child && child.type === 'button')
    if (transport.length !== 3) {
      failures.push(width + 'x' + height + ' transport buttons ' + transport.length + ' expected 3')
    }
    const classes = transport.map((child) => String(child.props.className))
    if (classes.join('|') !== 'dshmp-btn dshmp-btn-side|dshmp-btn dshmp-btn-main|dshmp-btn dshmp-btn-side') {
      failures.push(width + 'x' + height + ' transport order ' + classes.join('|'))
    }
  }


  // The disc is a real SVG circle at 0.797 of the stage diameter.
  const vinyl = findNode(tree, (node) => node.props && node.props.className === 'dshmp-vinyl')
  if (!vinyl) {
    failures.push(width + 'x' + height + ' vinyl missing')
  } else if (vinyl.type !== 'svg') {
    failures.push(width + 'x' + height + ' vinyl is a ' + vinyl.type + ', expected svg (border-radius can be overridden)')
  } else {
    const size = vinyl.props.width
    if (size !== vinyl.props.height) failures.push(width + 'x' + height + ' vinyl not square')
    if (Math.abs(size / style.height - 0.797) > 0.02) {
      failures.push(width + 'x' + height + ' vinyl ratio ' + (size / style.height).toFixed(3))
    }
    const body = findNode(
      vinyl,
      (node) => node.type === 'circle' && node.props.cx === 50 && node.props.cy === 50 && node.props.r === 50,
    )
    if (!body) failures.push(width + 'x' + height + ' disc body circle (r=50) missing')
    const rim = findNode(
      vinyl,
      (node) => node.type === 'circle' && String(node.props.stroke) === 'rgba(255,255,255,0.22)',
    )
    if (!rim) failures.push(width + 'x' + height + ' disc rim missing')

    // White label carrying the black DeepSeek whale.
    const label = findNode(
      vinyl,
      (node) => node.type === 'circle' && node.props.r === 17 && node.props.fill === '#ffffff',
    )
    if (!label) failures.push(width + 'x' + height + ' white label circle missing')
    // The label carries an original ribbon-bow mark (no brand or character art).
    const mark = findNode(
      vinyl,
      (node) => node.props && node.props.transform === 'translate(38.5 38.5) scale(0.46)',
    )
    if (!mark) failures.push(width + 'x' + height + ' centre mark group missing')
    else {
      const loops = (mark.children || []).filter((node) => node && node.type === 'path' && node.props.fill === '#000000')
      const knot = findNode(mark, (node) => node.type === 'rect' && node.props.fill === '#000000')
      if (loops.length !== 2) failures.push(width + 'x' + height + ' bow needs two loops')
      if (!knot) failures.push(width + 'x' + height + ' bow knot missing')
    }
    if (findNode(vinyl, (node) => typeof node.props?.d === 'string' && node.props.d.length > 1000)) {
      failures.push(width + 'x' + height + ' brand artwork must not come back')
    }

    // The specular highlight must not ride the spinning group.
    const spin = findNode(vinyl, (node) => node.props && node.props.className === 'dshmp-disc-spin')
    if (!spin) failures.push(width + 'x' + height + ' spinning group missing')
    else if (findNode(spin, (node) => node.props && String(node.props.fill) === 'url(#dshmp-grad-sheen)')) {
      failures.push(width + 'x' + height + ' highlight still rotates with the disc')
    }
    const sheen = findNode(vinyl, (node) => node.props && String(node.props.fill) === 'url(#dshmp-grad-sheen)')
    if (!sheen) failures.push(width + 'x' + height + ' static highlight missing')
    const sheenGrad = findNode(
      vinyl,
      (node) => node.type === 'radialGradient' && node.props.id === 'dshmp-grad-sheen',
    )
    if (!sheenGrad || sheenGrad.props.cx !== '74%' || sheenGrad.props.cy !== '22%') {
      failures.push(width + 'x' + height + ' highlight not pinned to the upper-right')
    }
  }

  const bracesOpen = (css.match(/\{/g) || []).length
  const bracesClose = (css.match(/\}/g) || []).length
  if (bracesOpen !== bracesClose) {
    failures.push(width + 'x' + height + ' unbalanced CSS braces: ' + bracesOpen + ' vs ' + bracesClose)
  }
  if (!/\.dshmp-mode\{[^}]*border-radius:11px/.test(css)) {
    failures.push(width + 'x' + height + ' mode dot style missing')
  }
  if (!/\.dshmp-vinyl\{[^}]*opacity:\.8/.test(css)) {
    failures.push(width + 'x' + height + ' vinyl opacity .8 missing from CSS')
  }
  if (!/\.dshmp-btn-side\{width:34px;height:34px/.test(css)) {
    failures.push(width + 'x' + height + ' side button size (34px) missing')
  }
  if (!/\.dshmp-btn-main\{width:51px;height:51px/.test(css)) {
    failures.push(width + 'x' + height + ' main button size (51px) missing')
  }
  if (!/\.dshmp-disc-spin\{[^}]*animation:dshmp-spin/.test(css)) {
    failures.push(width + 'x' + height + ' disc spin rule missing')
  }
  if (!/\.dshmp-controls\{[^}]*gap:17px/.test(css)) {
    failures.push(width + 'x' + height + ' control gap (17px) missing')
  }

  // Frosted glass, not a solid slab: the tint overlay must stay nearly clear,
  // keep its backdrop blur, and the blur must stay weak enough that content
  // behind it is still perceptible.
  const glass = /\.dshmp-glass\{([^}]*)\}/.exec(css)
  if (!glass) failures.push(width + 'x' + height + ' glass rule missing')
  else {
    // The bar and circle use the theme's raised-surface token, so the same rule
    // reads correctly on a white page and on a black one.
    if (!/background:color-mix\(in srgb,var\(--dsw-alias-bg-layer-1\) \d+%,transparent\)/.test(glass[1])) {
      failures.push(width + 'x' + height + ' glass surface must come from the theme token')
    }
    const blur = /blur\((\d+)px\)/.exec(glass[1])
    if (!blur) failures.push(width + 'x' + height + ' glass backdrop-filter missing')
    else if (Number(blur[1]) > 12) failures.push(width + 'x' + height + ' glass blur too strong: ' + blur[0])
  }
  // Small circles keep their glass on a dedicated layer clipped to a true circle,
  // otherwise backdrop-filter leaks a square edge outside the rounded box.
  // The three button families share one flat translucent fill. No backdrop-filter:
  // sampling the backdrop a few pixels outside a rounded box is what made the fill
  // look like a rounded square inside a circular frame.
  for (const name of ['dshmp-btn', 'dshmp-gear', 'dshmp-mode']) {
    const rule = new RegExp('^\\.' + name + '\\{([^}]*)\\}', 'm').exec(css)
    if (!rule) {
      failures.push(width + 'x' + height + ' button surface missing on ' + name)
      continue
    }
    if (/backdrop-filter/.test(rule[1])) {
      failures.push(width + 'x' + height + ' ' + name + ' must not sample the backdrop')
    }
    if (!/border-radius:\d+px/.test(rule[1]) && !/dshmp-btn/.test(name)) {
      failures.push(width + 'x' + height + ' ' + name + ' needs a fixed px radius')
    }
    if (!/background:color-mix\(in srgb,currentColor 18%,transparent\)/.test(rule[1])) {
      failures.push(width + 'x' + height + ' ' + name + ' must use the shared currentColor fill')
    }
  }
  // A fixed white (or fixed grey) hairline only works in one theme. Every panel
  // control now derives its ring from the text colour, so it inverts with the theme.
  for (const name of ['dshmp-iconbtn', 'dshmp-field', 'dshmp-inline-btn', 'dshmp-pill', 'dshmp-link-btn', 'dshmp-help-btn']) {
    const rule = new RegExp('^\\.' + name + '\\{([^}]*)\\}', 'm').exec(css)
    if (!rule) {
      failures.push(width + 'x' + height + ' ' + name + ' rule missing')
      continue
    }
    if (!/var\(--dshmp-ring\)/.test(rule[1])) {
      failures.push(width + 'x' + height + ' ' + name + ' needs the theme-derived ring')
    }
  }
  if (!/--dshmp-ring:color-mix\(in srgb,currentColor \d+%,transparent\)/.test(css)) {
    failures.push(width + 'x' + height + ' the ring scale must be a currentColor mix')
  }  // The seek and volume tracks need the same hairline, or they vanish on white.
  const trackRule = /\.dshmp-seek,\.dshmp-volume-track\{([^}]*)\}/.exec(css)
  if (!trackRule) failures.push(width + 'x' + height + ' slider track rule missing')
  else if (!/border:1px solid var\(--dshmp-ring\)/.test(trackRule[1])) {
    failures.push(width + 'x' + height + ' slider tracks need the dark grey hairline')
  }  // Volume separates "now" from "headroom" by tone: solid ivory fill on a dark well.
  const volumeRule = /^\.dshmp-volume-track\{([^}]*)\}/m.exec(css)
  if (!volumeRule || !/background:var\(--dshmp-mix-16\)/.test(volumeRule[1])) {
    failures.push(width + 'x' + height + ' volume track must use the dark well')
  }
  const volumeFillRule = /\.dshmp-volume-track \.dshmp-volume-fill\{([^}]*)\}/.exec(css)
  if (!volumeFillRule || !/background:var\(--dsw-alias-label-primary\)/.test(volumeFillRule[1])) {
    failures.push(width + 'x' + height + ' volume fill must be solid ivory')
  }
  const volumeNode = findNode(tree, (node) => node.props && node.props.className === 'dshmp-volume-track')
  if (!volumeNode) failures.push(width + 'x' + height + ' volume track missing')
  else if (
    !findNode(
      volumeNode,
      (node) => node.props && String(node.props.className).indexOf('dshmp-volume-fill') !== -1,
    )
  ) {
    failures.push(width + 'x' + height + ' volume fill is not marked apart from the seek fill')
  }  // Gear and play share one recipe: same fill, same ring, and the same theme
  // foreground (a hard-coded ivory vanished on a light surface).
  const gearRule = /^\.dshmp-gear\{([^}]*)\}/m.exec(css)
  if (!gearRule || !/color:var\(--dsw-alias-label-primary\)/.test(gearRule[1])) {
    failures.push(width + 'x' + height + ' gear must use the theme foreground')
  }
  const modeRule = /^\.dshmp-mode\{([^}]*)\}/m.exec(css)
  if (!modeRule || !/color:var\(--dsw-alias-label-primary\)/.test(modeRule[1])) {
    failures.push(width + 'x' + height + ' mode dots must use the theme foreground')
  }
  // The body of both small circles is painted on the element itself now, so no
  // pseudo-element box can leak a rounded-rect edge from its backdrop filter.
  for (const name of ['dshmp-gear::before', 'dshmp-mode::before']) {
    const rule = new RegExp('^\\.' + name + '\\{([^}]*)\\}', 'm').exec(css)
    if (rule && !/^$/.test(String(rule[1]).trim())) {
      failures.push(width + 'x' + height + ' ' + name + ' must not paint a body any more')
    }
  }  if (!/\.dshmp-mode-wrap\{/.test(css)) failures.push(width + 'x' + height + ' dot wrapper missing')
  const panelRule = /\.dshmp-panel\{([^}]*)\}/.exec(css)
  if (!panelRule || !/backdrop-filter:blur/.test(panelRule[1])) {
    failures.push(width + 'x' + height + ' panel backdrop-filter missing')
  }

  const panel = findNode(tree, (node) => node.props && String(node.props.className).indexOf('dshmp-panel') === 0)
  if (!panel) failures.push(width + 'x' + height + ' panel missing')
  else if (!(panel.props.style.maxHeight >= 150)) {
    failures.push(width + 'x' + height + ' panel maxHeight ' + panel.props.style.maxHeight)
  }

  const gear = findNode(tree, (node) => node.props && String(node.props.className).indexOf('dshmp-gear-anchor') === 0)
  if (!gear) failures.push(width + 'x' + height + ' gear anchor missing')

  const inputs = countByTag(tree, 'input')
  // volume percent + draft playlist row + search
  if (inputs !== 3) failures.push(width + 'x' + height + ' input count ' + inputs + ' expected 3')

  const audio = findNode(tree, (node) => node.type === 'audio')
  if (!audio) failures.push(width + 'x' + height + ' audio element missing')
  else if (typeof audio.props.onEnded !== 'function') failures.push(width + 'x' + height + ' audio has no ended handler')

  const buildTag = findNode(tree, (node) => node.props && node.props.className === 'dshmp-build')
  if (!buildTag || !/^v?\d+\.\d+\.\d+$|^b\d+$/.test(String((buildTag.children || []).join('')))) {
    failures.push(width + 'x' + height + ' build tag missing from the panel footer')
  }

  return tree
}

// --------------------------------------------------------- click / drag flow
function pointerEvent(x, y) {
  let captured = 0
  return {
    pointerType: 'mouse',
    button: 0,
    pointerId: 1,
    clientX: x,
    clientY: y,
    stopPropagation() {},
    currentTarget: {
      setPointerCapture() {
        captured += 1
      },
      releasePointerCapture() {
        captured -= 1
      },
    },
  }
}

function stageOf(tree) {
  return findNode(tree, (node) => node.props && String(node.props.className || '').indexOf('dshmp-stage') === 0)
}

function checkInteractions(width, height) {
  const runtime = createRuntime(width, height)
  if (!runtime) return
  const registered = []
  const ctx = {
    get: () => undefined,
    slots: {
      inject(key, callback) {
        callback()
        return () => {}
      },
      register(options, component) {
        registered.push(component)
        return () => {}
      },
    },
  }
  runtime.plugin.apply(ctx)
  const component = registered[0]

  let tree = renderTree(runtime, component)
  let stage = stageOf(tree)
  if (!stage) {
    failures.push(width + 'x' + height + ' interactions: no stage')
    return
  }

  // Dragging straight up must stop at the reserved title strip, not at the edge.
  stage.props.onPointerDown(pointerEvent(200, 400))
  stage.props.onPointerMove(pointerEvent(200, -600))
  tree = renderTree(runtime, component)
  stage = stageOf(tree)
  stage.props.onPointerUp(pointerEvent(200, -600))
  tree = renderTree(runtime, component)
  stage = stageOf(tree)
  const upMatch = /^translate3d\((-?[\d.]+)px,(-?[\d.]+)px,0\)$/.exec(stage.props.style.transform)
  if (upMatch && Number(upMatch[2]) < 116) {
    failures.push(width + 'x' + height + ' upward drag crossed the title strip: ' + upMatch[2])
  }
  // A click without movement expands the circle into the bar.
  const startTransform = stage.props.style.transform
  stage.props.onPointerDown(pointerEvent(200, 300))
  tree = renderTree(runtime, component)
  stage = stageOf(tree)
  stage.props.onPointerUp(pointerEvent(200, 300))
  tree = renderTree(runtime, component)
  stage = stageOf(tree)

  const diameter = tree && stage ? stage.props.style.height : 0
  const barWidth = stage ? stage.props.style.width : 0
  if (!stage || String(stage.props.className).indexOf('dshmp-bar') === -1) {
    failures.push(width + 'x' + height + ' click did not expand: ' + (stage && stage.props.className))
    return
  }
  const expected = Math.round(Math.min(195, width - 28))
  if (barWidth !== expected) failures.push(width + 'x' + height + ' bar width ' + barWidth + ' expected ' + expected)

  const match = /^translate3d\((-?[\d.]+)px,(-?[\d.]+)px,0\)$/.exec(stage.props.style.transform)
  const barX = match ? Number(match[1]) : NaN
  if (!(barX >= 14) || barX + barWidth > width - 13) {
    failures.push(width + 'x' + height + ' expanded out of bounds x=' + barX + ' w=' + barWidth)
  }

  // The gear becomes reachable below (or above) the bar and stays on screen.
  const gear = findNode(tree, (node) => node.props && String(node.props.className).indexOf('dshmp-gear ') === 0)
  if (!gear || gear.props.className.indexOf('dshmp-visible') === -1) {
    failures.push(width + 'x' + height + ' gear not visible after expand')
  }

  // Collapsing must return the circle to its exact pre-expansion coordinates,
  // even when the bar had to be clamped against the viewport edge.
  stage.props.onPointerDown(pointerEvent(300, 300))
  stage.props.onPointerUp(pointerEvent(300, 300))
  tree = renderTree(runtime, component)
  stage = stageOf(tree)
  if (!stage || String(stage.props.className).indexOf('dshmp-circle') === -1) {
    failures.push(width + 'x' + height + ' collapse did not return to the circle')
  } else if (stage.props.style.transform !== startTransform) {
    failures.push(
      width + 'x' + height + ' circle drifted: ' + startTransform + ' -> ' + stage.props.style.transform,
    )
  }

  // Expand again for the drag flow.
  stage.props.onPointerDown(pointerEvent(200, 300))
  tree = renderTree(runtime, component)
  stage = stageOf(tree)
  stage.props.onPointerUp(pointerEvent(200, 300))
  tree = renderTree(runtime, component)
  stage = stageOf(tree)

  // Dragging past the right edge clamps inside the viewport.
  stage.props.onPointerDown(pointerEvent(200, 300))
  stage.props.onPointerMove(pointerEvent(200 + width * 2, 300 + height * 2))
  tree = renderTree(runtime, component)
  stage = stageOf(tree)
  stage.props.onPointerUp(pointerEvent(200 + width * 2, 300 + height * 2))
  tree = renderTree(runtime, component)
  stage = stageOf(tree)
  const moved = /^translate3d\((-?[\d.]+)px,(-?[\d.]+)px,0\)$/.exec(stage.props.style.transform)
  const movedX = moved ? Number(moved[1]) : NaN
  const movedY = moved ? Number(moved[2]) : NaN
  if (movedX + barWidth > width - 13 || movedY + diameter > height - 13) {
    failures.push(width + 'x' + height + ' drag escaped viewport: ' + movedX + ',' + movedY)
  }
  if (movedX < 14) {
    failures.push(width + 'x' + height + ' drag negative position: ' + movedX + ',' + movedY)
  }
  if (movedY < 116) {
    failures.push(width + 'x' + height + ' drag entered the title strip: ' + movedY)
  }

  // Clicking the bar background collapses it back to the circle.
  stage.props.onPointerDown(pointerEvent(300, 300))
  stage.props.onPointerUp(pointerEvent(300, 300))
  tree = renderTree(runtime, component)
  stage = stageOf(tree)
  if (!stage || String(stage.props.className).indexOf('dshmp-circle') === -1) {
    failures.push(width + 'x' + height + ' second click did not collapse')
  }
}

// ------------------------------------------------------------ volume control
function checkVolume() {
  const runtime = createRuntime(1440, 900)
  if (!runtime) return
  const registered = []
  runtime.plugin.apply({
    get: () => undefined,
    slots: {
      inject(key, callback) {
        callback()
        return () => {}
      },
      register(options, component) {
        registered.push(component)
        return () => {}
      },
    },
  })
  const component = registered[0]
  let tree = renderTree(runtime, component)
  const ok = (condition, message) => {
    if (!condition) failures.push('volume: ' + message)
  }
  const valueOf = () => {
    const node = findNode(tree, (item) => item.props && item.props.className === 'dshmp-volinput')
    return node ? Number(node.props.value) : NaN
  }
  const typeInto = (text) => {
    const node = findNode(tree, (item) => item.props && item.props.className === 'dshmp-volinput')
    node.props.onChange({ target: { value: text } })
    tree = renderTree(runtime, component)
  }
  const spinNodes = () =>
    findAll(tree, (node) => node.props && String(node.props.className).indexOf('dshmp-spin-btn') === 0)
  const clickSpin = (index) => {
    spinNodes()[index].props.onClick({ stopPropagation() {}, preventDefault() {} })
    tree = renderTree(runtime, component)
  }

  // Both slider rows share one grid, so the seek and volume tracks line up.
  const rows = findAll(tree, (node) => node.props && String(node.props.className).indexOf('dshmp-slider-row') === 0)
  ok(rows.length === 2, 'seek and volume must share the slider grid, got ' + rows.length)
  const styleNode = findNode(tree, (node) => node.type === 'style')
  const css = styleNode && styleNode.children ? String(styleNode.children.join('')) : ''
  ok(
    /\.dshmp-slider-row\{[^}]*grid-template-columns:34px minmax\(0,1fr\) 72px/.test(css),
    'the shared grid template is missing',
  )

  // The settings panel is a fixed grey-black surface now, and its icons are plain
  // white at full opacity (the red warning triangle stays red on purpose).
  const panelRule = /^\.dshmp-panel\{([^}]*)\}/m.exec(css)
  ok(!!panelRule, 'panel rule missing')
  if (panelRule) {
    ok(
      /background:color-mix\(in srgb,var\(--dsw-alias-bg-overlay\) 58%,transparent\)/.test(panelRule[1]),
      'the panel surface must come from the theme overlay token',
    )
    ok(/color:var\(--dsw-alias-label-primary\)/.test(panelRule[1]), 'the panel must set one foreground colour')
  }
  ok(
    /\.dshmp-panel svg[^{]*\{[^}]*color:inherit;opacity:1/.test(css),
    'panel icons must inherit the text colour at full opacity',
  )
  const spinRule = /^\.dshmp-spin-btn\{([^}]*)\}/m.exec(css)
  ok(!!spinRule, 'stepper button rule missing')
  if (spinRule) {
    const width = /width:(\d+)px/.exec(spinRule[1])
    const height = /height:(\d+)px/.exec(spinRule[1])
    ok(width && Number(width[1]) >= 16, 'the stepper must be at least 16px wide, got ' + (width && width[1]))
    ok(height && Number(height[1]) >= 12, 'the stepper must be at least 12px tall, got ' + (height && height[1]))
  }

  // The trailing number is an editable percent field, clamped to 0..100.
  const input = findNode(tree, (node) => node.props && node.props.className === 'dshmp-volinput')
  ok(!!input, 'the volume value must be an input')
  if (input) {
    ok(input.props.type === 'number', 'the volume value must be a number input')
    ok(input.props.min === 0 && input.props.max === 100, 'the volume value must allow 0..100')
    ok(Number(input.props.value) === 80, 'the default volume should read 80, got ' + input.props.value)
  }
  typeInto('150')
  ok(valueOf() === 100, 'typing 150 must clamp to 100, got ' + valueOf())
  typeInto('-30')
  ok(valueOf() === 0, 'typing -30 must clamp to 0, got ' + valueOf())
  typeInto('42')
  ok(valueOf() === 42, 'typing 42 must land on 42, got ' + valueOf())
  typeInto('abc')
  ok(valueOf() === 42, 'garbage input must be ignored, got ' + valueOf())

  // Two triangles step by exactly one point each, clamped at both ends.
  ok(spinNodes().length === 2, 'the stepper needs exactly two triangles, got ' + spinNodes().length)
  clickSpin(0)
  ok(valueOf() === 43, 'the up triangle must add 1, got ' + valueOf())
  clickSpin(1)
  ok(valueOf() === 42, 'the down triangle must subtract 1, got ' + valueOf())
  typeInto('100')
  clickSpin(0)
  ok(valueOf() === 100, 'the up triangle must not pass 100, got ' + valueOf())
  typeInto('0')
  clickSpin(1)
  ok(valueOf() === 0, 'the down triangle must not pass 0, got ' + valueOf())
}

// ------------------------------------------------------ multi-link playlist
function findAll(tree, predicate) {
  const found = []
  walk(tree, (node) => {
    if (predicate(node)) found.push(node)
  })
  return found
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function reply(body) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }
}

function makeFetchStub() {
  const posts = []
  const playlistCalls = []
  const fetchStub = async (url, options) => {
    const target = String(url)
    const method = (options && options.method) || 'GET'
    const parsed = new URL(target, 'http://127.0.0.1')
    if (target.indexOf('/api/settings') !== -1) {
      if (method === 'POST') posts.push(JSON.parse(String((options && options.body) || '{}')))
      return reply({ ok: true, version: '1.102.0', settings: {} })
    }
    if (target.indexOf('/api/playlist') !== -1) {
      const link = parsed.searchParams.get('link') || ''
      const page = Number(parsed.searchParams.get('page') || 1)
      playlistCalls.push({ link, page })
      const empty = link.indexOf('empty') !== -1
      return reply({
        ok: true,
        title: 'T:' + link,
        items: empty ? [] : [{ bvid: 'bv-' + link, title: link, duration: 12 }],
        hasMore: false,
      })
    }
    return reply({ ok: true, items: [] })
  }
  return { fetchStub, posts, playlistCalls }
}

async function checkPlaylists() {
  const { fetchStub, posts, playlistCalls } = makeFetchStub()
  const runtime = createRuntime(1440, 900, { fetch: fetchStub })
  if (!runtime) return
  const registered = []
  runtime.plugin.apply({
    get: () => undefined,
    slots: {
      inject(key, callback) {
        callback()
        return () => {}
      },
      register(options, component) {
        registered.push(component)
        return () => {}
      },
    },
  })
  const component = registered[0]
  const state = { tree: null }
  const render = async () => {
    state.tree = renderTree(runtime, component)
    await flush()
    state.tree = renderTree(runtime, component)
    return state.tree
  }
  const ok = (condition, message) => {
    if (!condition) failures.push('playlists: ' + message)
  }

  await render()
  await flush()
  state.tree = renderTree(runtime, component)

  const rowsNode = () => findNode(state.tree, (node) => node.props && node.props.className === 'dshmp-rows')
  const rowInputs = () => findAll(rowsNode() || state.tree, (node) => node.type === 'input')
  const committed = () => rowInputs().filter((node) => node.props['data-dshmp-draft'] !== '1')
  const draftInput = () => rowInputs().find((node) => node.props['data-dshmp-draft'] === '1')
  const draftForm = () =>
    findNode(state.tree, (node) => node.props && String(node.props.className).indexOf('dshmp-plrow-draft') !== -1)
  const toggles = () =>
    findAll(rowsNode() || state.tree, (node) => node.type === 'button' && String(node.props.className).indexOf('dshmp-link-btn') !== -1)
  const connected = () => toggles().filter((node) => node.props['aria-pressed'] === 'true')
  const glyphPaths = (button) => {
    const svgNode = (button.children || []).find((child) => child && child.type === 'svg')
    return svgNode ? (svgNode.children || []).filter((child) => child && child.type === 'path').length : -1
  }
  const emptyRowCount = () => rowInputs().filter((node) => String(node.props.value) === '').length
  const listTracks = () =>
    findAll(
      state.tree,
      (node) => node.type === 'button' && /^dshmp-track( |$)/.test(String((node.props && node.props.className) || '')),
    )

  // A fresh profile seeds exactly one row from the fallback link, plus the draft.
  ok(rowInputs().length === 2, 'a fresh panel should show seed row + draft, got ' + rowInputs().length)
  ok(draftInput() !== undefined, 'the trailing draft input is missing on first render')

  const importLink = async (link) => {
    draftInput().props.onChange({ target: { value: link } })
    state.tree = await render()
    draftForm().props.onSubmit({ preventDefault() {} })
    await render()
    await flush()
    state.tree = renderTree(runtime, component)
  }

  // Rows only accept the public favourite-folder URL shape, so the fixtures use it.
  const linkFor = (id) => 'https://www.bilibili.com/medialist/detail/' + id
  for (let index = 1; index <= 10; index += 1) await importLink(linkFor('ml' + index))

  ok(rowInputs().length === 12, 'after ten imports expected 12 inputs (11 rows + draft), got ' + rowInputs().length)
  ok(emptyRowCount() === 1, 'exactly one empty input must remain, got ' + emptyRowCount())
  const lastInput = rowInputs()[rowInputs().length - 1]
  ok(lastInput && lastInput.props['data-dshmp-draft'] === '1', 'the empty input must be the trailing draft')
  ok(
    String(lastInput.props.value) === '' && committed().every((node) => String(node.props.value) !== ''),
    'committed rows must all hold a link',
  )

  // The row button labels the state: the connected row reads "播放中", every other
  // row invites a click with "点击播放"; the trailing draft keeps "载入".
  const rowButtons = () =>
    findAll(rowsNode() || state.tree, (node) => node.type === 'button' && node.props['data-row-action'])
  const labelOf = (node) => String((node.children || []).join(''))
  ok(rowButtons().length === committed().length, 'every committed row needs one action button')
  ok(
    rowButtons().filter((node) => node.props['data-row-action'] === 'playing').length === 1,
    'exactly one row may read as playing',
  )
  ok(
    rowButtons().every((node) =>
      node.props['data-row-action'] === 'playing' ? labelOf(node) === '播放中' : labelOf(node) === '点击播放',
    ),
    'row labels must follow the connection state: ' + JSON.stringify(rowButtons().map(labelOf)),
  )
  // The playing row is a state, not an action: the button is disabled and shows no
  // hover affordance, while every other row stays clickable.
  ok(
    rowButtons()
      .filter((node) => node.props['data-row-action'] === 'playing')
      .every((node) => node.props.disabled === true && node.props['aria-disabled'] === 'true'),
    'the 播放中 button must be disabled',
  )
  ok(
    rowButtons()
      .filter((node) => node.props['data-row-action'] !== 'playing')
      .every((node) => !node.props.disabled && node.props['aria-disabled'] === 'false'),
    'the 点击播放 buttons must stay enabled',
  )
  // The draft row has no button at all: Enter submits it, and its glyph is the
  // link-with-a-plus mark that says "add another link".
  const draftButtons = findAll(draftForm() || state.tree, (node) => node.type === 'button')
  ok(draftButtons.length === 0, 'the draft row must not carry a button, got ' + draftButtons.length)
  ok(
    draftInput().props.placeholder === committed()[0].props.placeholder,
    'the draft row uses the same placeholder as a normal row',
  )
  const addIcon = findNode(
    draftForm() || state.tree,
    (node) => node.props && String(node.props.className).indexOf('dshmp-link-add') !== -1,
  )
  ok(addIcon.props.title === undefined, 'the add-link icon must not carry an Enter hint')
  ok(!!addIcon, 'the draft row must show the add-link icon')
  if (addIcon) {
    const svgNode = findNode(addIcon, (node) => node.type === 'svg')
    ok(!!svgNode, 'the add-link icon must be an svg')
    const chain = svgNode && findNode(svgNode, (node) => node.type === 'g')
    ok(!!chain, 'the add-link icon must keep the chain group')
    const plusPaths = svgNode ? (svgNode.children || []).filter((child) => child && child.type === 'path') : []
    ok(plusPaths.length === 2, 'the plus needs two strokes, got ' + plusPaths.length)
  }

  // Exactly one row is connected and it draws the closed-chain glyph. A freshly
  // imported row must NOT take the connection: the seed row keeps it.
  ok(connected().length === 1, 'exactly one row may be connected, got ' + connected().length)
  ok(toggles().indexOf(connected()[0]) === 0, 'the seed row must stay connected after ten imports')
  ok(connected()[0].props['data-link-icon'] === 'link', 'the connected row must draw the chain glyph')
  ok(
    connected()[0].props.disabled === true && connected()[0].props['aria-disabled'] === 'true',
    'the connected row chain button must be disabled',
  )

  ok(glyphPaths(connected()[0]) === 2, 'chain glyph should be two paths, got ' + glyphPaths(connected()[0]))
  const disconnected = toggles().filter((node) => node.props['aria-pressed'] !== 'true')
  ok(disconnected.length === toggles().length - 1, 'every imported row stays disconnected, got ' + disconnected.length)
  ok(disconnected.every((node) => node.props['data-link-icon'] === 'unlink'), 'every disconnected row must draw the broken glyph')
  ok(disconnected.every((node) => glyphPaths(node) === 3), 'broken glyph should be three paths')
  ok(
    disconnected.every((node) => !node.props.disabled && node.props['aria-disabled'] === 'false'),
    'every disconnected chain button must stay clickable',
  )
  ok(
    rowButtons().filter((node) => node.props['data-row-action'] === 'playing').length === 1 &&
      labelOf(rowButtons()[0]) === '播放中' &&
      rowButtons()
        .slice(1)
        .every((node) => labelOf(node) === '点击播放'),
    'only the connected row may read 播放中',
  )

  // Submitting the connected row must be inert too (its button is disabled, but
  // pressing Enter in the input still submits that form).
  const rowForms = () =>
    findAll(state.tree, (node) => node.props && /^dshmp-plrow( |$)/.test(String(node.props.className)))
  const callsBeforeSubmit = playlistCalls.length
  rowForms()[0].props.onSubmit({ preventDefault() {} })
  state.tree = await render()
  ok(playlistCalls.length === callsBeforeSubmit, 'submitting the connected row must not reload')
  ok(listTracks().length === 1, 'the connected row keeps its tracks')

  // Deleting an idle middle row keeps the trailing draft and the connection.
  const loadedBefore = playlistCalls.length
  const middleIndex = Math.floor(committed().length / 2)
  committed()[middleIndex].props.onChange({ target: { value: '' } })
  state.tree = await render()
  ok(rowInputs().length === 11, 'delete-middle: expected 11 inputs, got ' + rowInputs().length)
  ok(emptyRowCount() === 1, 'delete-middle: exactly one empty input expected')
  ok(rowInputs()[rowInputs().length - 1].props['data-dshmp-draft'] === '1', 'delete-middle: draft must stay last')
  ok(playlistCalls.length === loadedBefore, 'delete-middle: dropping an idle row must not reload')

  // The last committed row is idle too: deleting it must not move the connection.
  const rowsBefore = committed().length
  committed()[rowsBefore - 1].props.onChange({ target: { value: '' } })
  state.tree = await render()
  ok(rowInputs().length === 10, 'delete-last: expected 10 inputs, got ' + rowInputs().length)
  ok(committed().length === rowsBefore - 1, 'delete-last: one committed row removed')
  ok(emptyRowCount() === 1, 'delete-last: exactly one empty input expected')
  ok(rowInputs()[rowInputs().length - 1].props['data-dshmp-draft'] === '1', 'delete-last: draft must stay last')
  ok(toggles().indexOf(connected()[0]) === 0, 'delete-last: the seed row keeps the connection')
  ok(playlistCalls.length === loadedBefore, 'delete-last: dropping an idle row must not reload')

  // Deleting the connected row hands the connection to the first survivor.
  const beforeHandover = playlistCalls.length
  committed()[0].props.onChange({ target: { value: '' } })
  state.tree = await render()
  await flush()
  state.tree = renderTree(runtime, component)
  ok(rowInputs().length === 9, 'delete-first: expected 9 inputs, got ' + rowInputs().length)
  ok(emptyRowCount() === 1, 'delete-first: exactly one empty input expected')
  ok(rowInputs()[rowInputs().length - 1].props['data-dshmp-draft'] === '1', 'delete-first: draft must stay last')
  ok(connected().length === 1, 'delete-first: the connection must hand over, got ' + connected().length)
  ok(playlistCalls.length > beforeHandover, 'delete-first: the surviving row should be loaded')
  const handedOver = committed()[0].props.value
  ok(playlistCalls[playlistCalls.length - 1].link === handedOver, 'delete-first: loaded the wrong playlist')
  ok(listTracks().length === 1 && listTracks()[0].props.title === handedOver, 'the list must follow the connected row')

  // A link that already exists is rejected: no new row, a toast, and the original
  // row's border flashes red for three seconds before it fades out.
  await importLink(linkFor('ml-dup-probe'))
  const rowsBeforeDup = committed().length
  const callsBeforeDup = playlistCalls.length
  draftInput().props.onChange({ target: { value: linkFor('ml-dup-probe') } })
  state.tree = await render()
  draftForm().props.onSubmit({ preventDefault() {} })
  state.tree = await render()
  ok(rowInputs().length === rowsBeforeDup + 1, 'a duplicate import must not add a row')
  ok(playlistCalls.length === callsBeforeDup, 'a duplicate import must not start playing')
  const dupField = findNode(
    state.tree,
    (node) => node.props && String(node.props.className).indexOf('dshmp-field-dup') !== -1,
  )
  ok(!!dupField, 'the existing row must flash red')
  const dupToast = findNode(state.tree, (node) => node.props && String(node.props.className).indexOf('dshmp-msg') === 0)
  ok(
    dupToast && String((dupToast.children || []).join('')) === '已有重复歌单',
    'a duplicate import must say 已有重复歌单, saw ' + JSON.stringify(dupToast && (dupToast.children || []).join('')),
  )
  const styleNodeLocal = findNode(state.tree, (node) => node.type === 'style')
  const cssLocal = styleNodeLocal && styleNodeLocal.children ? String(styleNodeLocal.children.join('')) : ''
  if (!/\.dshmp-field\.dshmp-field-dup\{[^}]*box-shadow:inset 0 0 0 1px var\(--dsw-alias-state-warn-primary/.test(cssLocal)) {
    failures.push('playlists: the duplicate border must use the warning token')
  }
  if (!/\.dshmp-field\.dshmp-field-dup\{[^}]*transition:box-shadow \.6s ease/.test(cssLocal)) {
    failures.push('playlists: the duplicate border must fade out')
  }
  // Yellow means "warning", red means "error": keep them apart in the CSS.
  if (!/\.dshmp-link-btn\.dshmp-link-warn\{[^}]*var\(--dsw-alias-state-warn-primary/.test(cssLocal)) {
    failures.push('playlists: the empty state icon must be the warning colour')
  }
  if (!/\.dshmp-inline-btn\.dshmp-inline-btn-warn\{[^}]*var\(--dsw-alias-state-warn-primary/.test(cssLocal)) {
    failures.push('playlists: the empty state button must be the warning colour')
  }
  if (!/\.dshmp-msg\.dshmp-warn\{[^}]*var\(--dsw-alias-state-warn-primary/.test(cssLocal)) {
    failures.push('playlists: the duplicate toast must be the warning colour')
  }
  ok(
    dupToast && String(dupToast.props.className).indexOf('dshmp-warn') !== -1,
    'the duplicate toast must carry the warn class',
  )
  await sleep(3100)
  state.tree = await render()
  const dupFieldAfter = findNode(
    state.tree,
    (node) => node.props && String(node.props.className).indexOf('dshmp-field-dup') !== -1,
  )

  ok(!dupFieldAfter, 'the red border must clear after three seconds')
  // A valid link whose playlist is empty: the row shows 空, disabled, in yellow —
  // the same shape as the malformed state, a different colour.
  await importLink(linkFor('ml-empty'))
  const emptyIndex = committed().findIndex((node) => String(node.props.value) === linkFor('ml-empty'))
  ok(emptyIndex >= 0, 'the empty fixture row must exist')
  toggles()[emptyIndex].props.onClick()
  await render()
  await flush()
  state.tree = renderTree(runtime, component)
  // Switching to an empty playlist flips the row immediately: 播放中 becomes 空.
  ok(
    labelOf(rowButtons()[emptyIndex]) === '空',
    'an empty playlist must read 空 as soon as it is connected, got ' + labelOf(rowButtons()[emptyIndex]),
  )
  ok(rowButtons()[emptyIndex].props.disabled === true, 'the 空 button is disabled from the start')
  ok(
    rowButtons()[emptyIndex].props['data-row-action'] === 'empty',
    'the row must be marked empty right away',
  )
  ok(toggles()[emptyIndex].props['data-link-icon'] === 'empty', 'the icon switches on load')
  ok(listTracks().length === 0, 'the empty playlist has no tracks')
  // Pressing play on it still explains why nothing happens.
  const playButton = findNode(
    state.tree,
    (node) => node.type === 'button' && String(node.props.className).indexOf('dshmp-btn-main') !== -1,
  )
  ok(!!playButton, 'the transport play button must exist')
  playButton.props.onClick({ stopPropagation() {} })
  state.tree = await render()
  const emptyButtons = rowButtons()
  ok(labelOf(emptyButtons[emptyIndex]) === '空', 'still 空 after a play attempt, got ' + labelOf(emptyButtons[emptyIndex]))
  ok(emptyButtons[emptyIndex].props.disabled === true, 'the 空 button must be disabled')
  ok(
    emptyButtons[emptyIndex].props['data-row-action'] === 'empty',
    'the empty row must be marked as such, got ' + emptyButtons[emptyIndex].props['data-row-action'],
  )
  ok(
    toggles()[emptyIndex].props['data-link-icon'] === 'empty',
    'the empty row icon must switch to the warning glyph',
  )
  const emptyToast = findNode(state.tree, (node) => node.props && String(node.props.className).indexOf('dshmp-msg') === 0)
  ok(
    emptyToast && String((emptyToast.children || []).join('')) === '歌单为空',
    'the play attempt must say 歌单为空, saw ' + JSON.stringify(emptyToast && (emptyToast.children || []).join('')),
  )
  ok(String(emptyToast.props.className).indexOf('dshmp-warn') !== -1, 'the empty hint must be the warning colour')
  // Adding yet another row must not steal the connection either.
  const stillConnected = toggles().indexOf(connected()[0])
  const callsBeforeAdd = playlistCalls.length
  await importLink(linkFor('ml-extra'))
  ok(toggles().indexOf(connected()[0]) === stillConnected, 'a new import must not move the connection')
  ok(playlistCalls.length === callsBeforeAdd, 'a new import must not start playing by itself')
  const hintNode = findNode(state.tree, (node) => node.props && String(node.props.className).indexOf('dshmp-msg') === 0)
  ok(
    hintNode && String((hintNode.children || []).join('')) === '添加成功',
    'an import must tell the user to press play, saw ' + JSON.stringify(hintNode && (hintNode.children || []).join('')),
  )
  const orderIndex = (predicate) => {
    let index = -1
    let counter = 0
    walk(state.tree, (node) => {
      if (index < 0 && predicate(node)) index = counter
      counter += 1
    })
    return index
  }
  const msgIndex = orderIndex((node) => node.props && String(node.props.className).indexOf('dshmp-msg') === 0)
  const rowsIndex = orderIndex((node) => node.props && node.props.className === 'dshmp-rows')
  ok(msgIndex >= 0 && rowsIndex >= 0 && msgIndex < rowsIndex, 'the status line must sit above the playlist rows')
  // The connection may be sitting on the empty row by now, so count connections
  // rather than the 播放中 label.
  ok(connected().length === 1, 'still exactly one connected row after an import')
  // A malformed link becomes an error row: red triangle glyph, 格式错误 label, both
  // inert. Editing the text back to a valid URL restores the normal state.
  const badIndex = 1
  const callsBeforeBad = playlistCalls.length
  committed()[badIndex].props.onChange({ target: { value: 'https://example.com/not-a-playlist' } })
  state.tree = await render()
  ok(toggles()[badIndex].props['data-link-icon'] === 'warn', 'a malformed link shows the warning glyph')
  ok(toggles()[badIndex].props.disabled === true, 'the warning glyph must not be a button')
  ok(labelOf(rowButtons()[badIndex]) === '格式错误', 'the row label must read 格式错误')
  ok(
    rowButtons()[badIndex].props.disabled === true && rowButtons()[badIndex].props['data-row-action'] === 'invalid',
    'the invalid row button must be inert',
  )
  rowForms()[badIndex].props.onSubmit({ preventDefault() {} })
  state.tree = await render()
  ok(playlistCalls.length === callsBeforeBad, 'an invalid row must never load anything')
  committed()[badIndex].props.onChange({ target: { value: linkFor('ml-fixed') } })
  state.tree = await render()
  ok(toggles()[badIndex].props['data-link-icon'] === 'unlink', 'fixing the link restores the chain glyph')
  ok(labelOf(rowButtons()[badIndex]) === '点击播放', 'fixing the link restores the play label')
  // Rapid switching: three clicks in the same tick, only the last one sticks.
  const links = committed().map((node) => String(node.props.value))
  const targets = [1, 2, 3].filter((index) => index < links.length)
  const buttons = toggles()
  buttons[targets[0]].props.onClick()
  // Switching drops the previous playlist synchronously: nothing of the old row
  // may stay in the list while the new one loads.
  const rightAfterSwitch = renderTree(runtime, component)
  const staleTracks = findAll(
    rightAfterSwitch,
    (node) => node.type === 'button' && /^dshmp-track( |$)/.test(String((node.props && node.props.className) || '')),
  )
  ok(staleTracks.length === 0, 'switching must clear the previous list immediately, saw ' + staleTracks.length)
  targets.slice(1).forEach((index) => buttons[index].props.onClick())
  await render()
  await flush()
  state.tree = renderTree(runtime, component)
  ok(connected().length === 1, 'after rapid switching still exactly one row is connected, got ' + connected().length)
  const wantedLink = links[targets[targets.length - 1]]
  const connectedIndex = toggles().indexOf(connected()[0])
  ok(
    committed()[connectedIndex] && String(committed()[connectedIndex].props.value) === wantedLink,
    'the last clicked row must own the connection',
  )
  ok(connected()[0].props['data-link-icon'] === 'link', 'the winning row must draw the chain glyph')
  ok(
    toggles()
      .filter((node) => node.props['aria-pressed'] !== 'true')
      .every((node) => node.props['data-link-icon'] === 'unlink'),
    'the losers must draw the broken glyph',
  )
  ok(playlistCalls[playlistCalls.length - 1].link === wantedLink, 'the last load must be the winning row')
  const playingLabels = rowButtons().filter((node) => node.props['data-row-action'] === 'playing')
  ok(playingLabels.length === 1 && labelOf(playingLabels[0]) === '播放中', 'exactly one row may read 播放中 after switching')
  ok(
    playingLabels[0].props.disabled === true,
    'the winning row keeps its disabled 播放中 button',
  )
  ok(
    rowButtons()
      .filter((node) => node.props['data-row-action'] !== 'playing')
      .every((node) => labelOf(node) === '点击播放'),
    'the other rows must invite a click',
  )
  ok(
    listTracks().length === 1 && listTracks()[0].props.title === wantedLink,
    'the visible list must match the connected row, got ' + JSON.stringify(listTracks().map((node) => node.props.title)),
  )

  // The row list and the connection survive a debounce round-trip to the host.
  await sleep(450)
  const persisted = posts.filter((body) => Array.isArray(body.plists))
  ok(persisted.length > 0, 'the row list must be persisted through /api/settings')
  if (persisted.length) {
    const last = persisted[persisted.length - 1]
    ok(last.plists.length === committed().length, 'persisted rows ' + last.plists.length + ' expected ' + committed().length)
    ok(typeof last.activeId === 'number' && last.activeId > 0, 'persisted activeId ' + last.activeId)
  }
}

;(async () => {
  checkSize(1440, 900)
  checkSize(1024, 700)
  checkSize(390, 780) // narrow / phone-ish
  checkSize(320, 480) // smallest sane window
  checkInteractions(1440, 900)
  checkInteractions(360, 720)
  checkVolume()
  try {
    await checkPlaylists()
  } catch (error) {
    failures.push('playlists flow threw: ' + error.message)
  }

  if (failures.length) {
    console.error('FAIL')
    failures.forEach((line) => console.error(' - ' + line))
    process.exit(1)
  }
  console.log('smoke test OK: layout, interactions and multi-link playlist flow')
})()
