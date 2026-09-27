const MIN_FRAME_GAP_MS = 120
const HIDDEN_BOUNDS = { windowState: 'minimized' }
const SHOWN_BOUNDS = { left: 80, top: 80, width: 1280, height: 720, windowState: 'normal' }

export function createOutreachPreview() {
  let cdp = null
  let browserCdp = null
  let livePage = null
  let windowId = 0
  let savedBounds = { ...SHOWN_BOUNDS }
  let generation = 0
  let mode = 'window'
  let muted = true
  let paused = false
  let jpeg = ''
  let updatedAt = 0
  let lastNotify = 0
  const listeners = new Set()

  function notify(force = false) {
    const now = Date.now()
    if (!force && now - lastNotify < MIN_FRAME_GAP_MS) return
    lastNotify = now
    for (const fn of listeners) {
      try { fn() } catch { /* ignore */ }
    }
  }

  function controlSession() {
    return browserCdp || cdp
  }

  async function resolveWindow(pageCdp) {
    const control = controlSession()
    if (!control) return 0
    let params = {}
    try {
      const info = await pageCdp.send('Target.getTargetInfo')
      if (info?.targetInfo?.targetId) params = { targetId: info.targetInfo.targetId }
    } catch {
      /* page session is already bound to this target */
    }
    let win = null
    try {
      win = await control.send('Browser.getWindowForTarget', params)
    } catch {
      win = await pageCdp.send('Browser.getWindowForTarget').catch(() => null)
    }
    const id = Number(win?.windowId) || 0
    if (!id) return 0
    const current = await control.send('Browser.getWindowBounds', { windowId: id }).catch(() => null)
    const bounds = current?.bounds
    if (bounds) {
      savedBounds = {
        left: Number.isFinite(Number(bounds.left)) ? Number(bounds.left) : SHOWN_BOUNDS.left,
        top: Number.isFinite(Number(bounds.top)) ? Number(bounds.top) : SHOWN_BOUNDS.top,
        width: Math.max(100, Number(bounds.width) || SHOWN_BOUNDS.width),
        height: Math.max(100, Number(bounds.height) || SHOWN_BOUNDS.height),
        windowState: 'normal',
      }
    }
    return id
  }

  async function attach(page) {
    await detach()
    const context = typeof page?.context === 'function' ? page.context() : page?.context
    if (!context || typeof context.newCDPSession !== 'function') return
    const gen = ++generation
    livePage = page
    const pageCdp = await context.newCDPSession(page)
    cdp = pageCdp
    const browser = typeof context.browser === 'function' ? context.browser() : null
    if (browser && typeof browser.newBrowserCDPSession === 'function') {
      browserCdp = await browser.newBrowserCDPSession().catch(() => null)
    }
    try {
      windowId = await resolveWindow(pageCdp)
    } catch {
      windowId = 0
    }
    pageCdp.on('Page.screencastFrame', async (event) => {
      if (gen !== generation) return
      jpeg = String(event?.data || '')
      updatedAt = Date.now()
      notify()
      await pageCdp.send('Page.screencastFrameAck', { sessionId: event.sessionId }).catch(() => {})
    })
    await pageCdp.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 42,
      maxWidth: 720,
      maxHeight: 405,
      everyNthFrame: 1,
    })
    mode = 'window'
    muted = true
    paused = false
    await syncPageMedia(pageCdp)
    notify(true)
  }

  async function detach() {
    generation += 1
    const pageSession = cdp
    const hostSession = browserCdp
    cdp = null
    browserCdp = null
    livePage = null
    windowId = 0
    jpeg = ''
    updatedAt = 0
    mode = 'window'
    muted = true
    paused = false
    savedBounds = { ...SHOWN_BOUNDS }
    if (pageSession) {
      await pageSession.send('Page.stopScreencast').catch(() => {})
      if (typeof pageSession.detach === 'function') await pageSession.detach().catch(() => {})
    }
    if (hostSession && typeof hostSession.detach === 'function') {
      await hostSession.detach().catch(() => {})
    }
    notify(true)
  }

  async function setMode(next) {
    mode = next === 'pip' ? 'pip' : 'window'
    const session = controlSession()
    if (session && windowId) {
      const bounds = mode === 'pip' ? HIDDEN_BOUNDS : savedBounds
      await session.send('Browser.setWindowBounds', { windowId, bounds }).catch(() => {})
    }
    if (mode === 'window' && livePage && typeof livePage.bringToFront === 'function') {
      await livePage.bringToFront().catch(() => {})
    }
    notify(true)
    return mode
  }

  async function syncPageMedia(pageCdp = cdp) {
    if (pageCdp) {
      await pageCdp.send('Page.setAudioMuted', { muted }).catch(() => {})
    }
    if (livePage && typeof livePage.evaluate === 'function') {
      await livePage.evaluate(({ nextMuted, nextPaused }) => {
        window.__chihiroMuted = nextMuted
        window.__chihiroPaused = nextPaused
        const apply = () => {
          for (const el of document.querySelectorAll('video, audio')) {
            el.muted = window.__chihiroMuted === true
            if (window.__chihiroPaused) el.pause()
          }
        }
        if (!window.__chihiroMediaHook) {
          window.__chihiroMediaHook = true
          const proto = HTMLMediaElement.prototype
          const play = proto.play
          proto.play = function (...args) {
            if (window.__chihiroMuted) this.muted = true
            if (window.__chihiroPaused) {
              this.pause()
              return Promise.resolve()
            }
            return play.apply(this, args)
          }
          new MutationObserver(apply).observe(document.documentElement, { childList: true, subtree: true })
        }
        apply()
      }, { nextMuted: muted, nextPaused: paused }).catch(() => {})
    }
  }

  async function setMuted(next) {
    muted = next !== false
    await syncPageMedia()
    notify(true)
    return muted
  }

  async function setPlayback(next) {
    paused = next === 'paused' || next === true
    await syncPageMedia()
    notify(true)
    return paused
  }

  function snapshot() {
    return { mode, available: Boolean(jpeg), updatedAt, muted, paused }
  }

  function frame() {
    return jpeg
  }

  function subscribe(fn) {
    listeners.add(fn)
    return () => listeners.delete(fn)
  }

  return { attach, detach, setMode, setMuted, setPlayback, snapshot, frame, subscribe }
}
