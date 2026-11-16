import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export async function startBrowser(baseUrl, artifacts) {
  assert.ok(['127.0.0.1', 'localhost'].includes(new URL(baseUrl).hostname))
  const profile = await mkdtemp(join(tmpdir(), 'liftboard-e1-profile-'))
  const browser = spawn(process.env.LIFTBOARD_TEST_CHROME ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
    '--headless=new', '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1',
    `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions', 'about:blank',
  ], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
  let socket
  const errors = []
  const pending = new Map()
  let nextId = 0
  function command(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++nextId
      const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`Délai : ${method}`)) }, 10000)
      pending.set(id, { resolve, reject, timeout })
      socket.send(JSON.stringify({ id, method, params }))
    })
  }
  async function evaluate(expression) {
    const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
    return result.result.value
  }
  const call = (fn, ...args) => evaluate(`(${fn.toString()})(${args.map(value => JSON.stringify(value)).join(',')})`)
  const settle = () => evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  async function waitForApp() {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await evaluate('Boolean(document.querySelector("#workout-page-title"))')) { await settle(); return }
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    throw new Error('Application non affichée')
  }
  try {
    const address = await new Promise((resolve, reject) => {
      let output = ''
      const timeout = setTimeout(() => reject(new Error(`Chrome : ${output.slice(-500)}`)), 12000)
      browser.once('error', error => { clearTimeout(timeout); reject(error) })
      browser.stderr.on('data', chunk => {
        output += chunk.toString()
        const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/)
        if (match) { clearTimeout(timeout); resolve(match[1]) }
      })
    })
    const debugOrigin = new URL(address).origin.replace('ws:', 'http:')
    const target = await (await fetch(`${debugOrigin}/json/new?${encodeURIComponent(baseUrl)}`, { method: 'PUT' })).json()
    socket = new WebSocket(target.webSocketDebuggerUrl)
    socket.addEventListener('message', event => {
      const data = JSON.parse(event.data)
      if (data.id && pending.has(data.id)) {
        const item = pending.get(data.id)
        clearTimeout(item.timeout)
        pending.delete(data.id)
        if (data.error) item.reject(new Error(JSON.stringify(data.error)))
        else item.resolve(data.result)
      }
      if (data.method === 'Runtime.exceptionThrown') errors.push(data.params.exceptionDetails)
      if (data.method === 'Page.javascriptDialogOpening') command('Page.handleJavaScriptDialog', { accept: true }).catch(() => {})
    })
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }) })
    await command('Page.enable')
    await command('Runtime.enable')
    await waitForApp()
  } catch (error) {
    socket?.close()
    browser.kill()
    throw error
  }
  return {
    command, evaluate, call, settle, errors,
    async reload() { await command('Page.reload'); await new Promise(resolve => setTimeout(resolve, 200)); await waitForApp() },
    async viewport(width, height = 960) { await command('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 960 }); await settle() },
    async capture(name) {
      await evaluate('document.fonts.ready.then(() => true)')
      const result = await command('Page.captureScreenshot', { format: 'png' })
      await writeFile(join(artifacts, `${name}.png`), Buffer.from(result.data, 'base64'))
    },
    async click(label, scope = 'body') {
      assert.ok(await call((label, scope) => {
        const button = [...document.querySelector(scope).querySelectorAll('button')].find(element => element.getClientRects().length && (element.textContent.trim() === label || element.getAttribute('aria-label') === label))
        if (!button) return false
        button.scrollIntoView({ block: 'nearest' })
        button.focus({ preventScroll: true })
        button.click()
        return true
      }, label, scope), `Bouton introuvable : ${label}`)
      await settle()
    },
    async enter(selector, value) {
      await call((selector, value) => {
        const input = document.querySelector(selector)
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value)
        input.dispatchEvent(new Event('input', { bubbles: true }))
      }, selector, value)
      await settle()
    },
    async key(key, code, modifiers = 0) {
      await command('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: code, modifiers, ...(key === 'Enter' ? { text: '\r' } : {}) })
      await command('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: code })
      await settle()
    },
    close() { for (const item of pending.values()) clearTimeout(item.timeout); socket?.close(); browser.kill() },
  }
}
