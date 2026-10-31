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

function createRuntime(width, height) {
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
  return { plugin, React, hooks, resetCursor: () => (cursor = 0), dirty }
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
    if (x < 14 || y < 14) failures.push(width + 'x' + height + ' position off-screen ' + x + ',' + y)
    if (x + style.width > width - 13) failures.push(width + 'x' + height + ' right overflow ' + (x + style.width))
    if (y + style.height > height - 13) failures.push(width + 'x' + height + ' bottom overflow ' + (y + style.height))
  }

  const buttons = countByTag(tree, 'button')
  // 3 transport + gear + close + load + repeat + shuffle + mute + 2 mode dots + help
  if (buttons !== 12) failures.push(width + 'x' + height + ' button count ' + buttons + ' expected 12')

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
    const selectedRing = findNode(selectedDot, (node) => node.props && node.props.className === 'dshmp-ring')
    const plainRing = findNode(plainDot, (node) => node.props && node.props.className === 'dshmp-ring')
    if (!selectedRing || !plainRing) failures.push(width + 'x' + height + ' dot borders must be svg circles')
    const base = selectedRing && findNode(
      selectedRing,
      (node) => node.type === 'circle' && String(node.props.stroke) === 'rgba(255,255,255,0.22)',
    )
    if (!base) failures.push(width + 'x' + height + ' 1px circle border missing')
    else {
      if (base.props.r !== 18.5) failures.push(width + 'x' + height + ' border radius drifted')
      if (base.props.strokeWidth !== 1) failures.push(width + 'x' + height + ' border must stay 1px')
    }
    // The comet ring is replaced by icon motion: ripple for repeat-one, a
    // left-to-right light sweep for shuffle.
    if (findNode(tree, (node) => node.props && node.props.className === 'dshmp-ring-arc')) {
      failures.push(width + 'x' + height + ' the comet ring must be gone')
    }
    if (!/@keyframes dshmp-ripple/.test(css)) {
      failures.push(width + 'x' + height + ' repeat ripple keyframes missing')
    }
    if (!/@keyframes dshmp-flow-x/.test(css)) {
      failures.push(width + 'x' + height + ' shuffle flow keyframes missing')
    }
    if (!/\.dshmp-mode-shuffle\.dshmp-selected \.dshmp-mode>svg\{[^}]*mask-image:linear-gradient/.test(css)) {
      failures.push(width + 'x' + height + ' shuffle icon must stream left to right')
    }
    const repeatDot = findNode(
      tree,
      (node) => node.props && String(node.props.className).indexOf('dshmp-mode-repeat') !== -1,
    )
    if (repeatDot && findNode(repeatDot, (node) => node.props && node.props.className === 'dshmp-ripple')) {
      failures.push(width + 'x' + height + ' ripple may only run on the selected dot')
    }
  }

  const gearRing = findNode(tree, (node) => node.props && node.props.className === 'dshmp-gear-ring')
  if (!gearRing) failures.push(width + 'x' + height + ' gear border must be an svg circle')
  else {
    const gearCircle = findNode(gearRing, (node) => node.type === 'circle' && node.props.strokeWidth === 1)
    if (!gearCircle || gearCircle.props.r !== 21 || gearCircle.props.strokeWidth !== 1) {
      failures.push(width + 'x' + height + ' gear border must be a 1px svg circle')
    }
  }

  const seek = findNode(tree, (node) => node.props && node.props.className === 'dshmp-seek')
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
  if (!/\.dshmp-mode\{[^}]*border-radius:50%/.test(css)) {
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
    const tint = /rgba\(18,20,26,\.(\d+)\)/.exec(glass[1])
    if (!tint) failures.push(width + 'x' + height + ' glass tint fallback missing')
    else if (Number('0.' + tint[1]) > 0.06) failures.push(width + 'x' + height + ' glass tint too opaque: ' + tint[0])
    const blur = /blur\((\d+)px\)/.exec(glass[1])
    if (!blur) failures.push(width + 'x' + height + ' glass backdrop-filter missing')
    else if (Number(blur[1]) > 12) failures.push(width + 'x' + height + ' glass blur too strong: ' + blur[0])
  }
  // Small circles keep their glass on a dedicated layer clipped to a true circle,
  // otherwise backdrop-filter leaks a square edge outside the rounded box.
  // Small circles: body and border are SVG circles, so nothing is painted from a
  // CSS box and nothing samples the backdrop.
  // Every button, including the gear and the two dots, shares one glass recipe:
  // 55% grey over a 9px backdrop blur.
  for (const name of ['dshmp-btn', 'dshmp-gear::before', 'dshmp-mode::before']) {
    const rule = new RegExp('\\.' + name.replace('::', '::') + '\\{([^}]*)\\}').exec(css)
    if (!rule) {
      failures.push(width + 'x' + height + ' glass layer missing on ' + name)
      continue
    }
    if (!/backdrop-filter:blur\(9px\)/.test(rule[1])) {
      failures.push(width + 'x' + height + ' ' + name + ' must use the shared 9px blur')
    }
    if (!/background:rgba\(150,158,172,\.55\)/.test(rule[1])) {
      failures.push(width + 'x' + height + ' ' + name + ' must use the shared grey fill')
    }
  }
  if (!/\.dshmp-mode-wrap\{/.test(css)) failures.push(width + 'x' + height + ' dot wrapper missing')
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
  if (inputs !== 2) failures.push(width + 'x' + height + ' input count ' + inputs + ' expected 2')

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
  if (movedX < 14 || movedY < 14) {
    failures.push(width + 'x' + height + ' drag negative position: ' + movedX + ',' + movedY)
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

checkSize(1440, 900)
checkSize(1024, 700)
checkSize(390, 780) // narrow / phone-ish
checkSize(320, 480) // smallest sane window
checkInteractions(1440, 900)
checkInteractions(360, 720)

if (failures.length) {
  console.error('FAIL')
  failures.forEach((line) => console.error(' - ' + line))
  process.exit(1)
}
console.log('smoke test OK: module loads, slot entry registered, tree renders at 4 viewport sizes')
