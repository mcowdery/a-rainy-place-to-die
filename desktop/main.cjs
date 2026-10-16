// The desktop shell: the standard build (dist/) in a window of its own, served from an app:// origin so saves
// (localStorage) stay put between runs. F11 toggles fullscreen.
const { app, BrowserWindow, protocol, net, Menu } = require('electron')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const root = path.join(__dirname, '..', 'dist')

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
])

app.commandLine.appendSwitch('ignore-gpu-blocklist')
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

app.whenReady().then(() => {
  protocol.handle('app', (req) => {
    const u = new URL(req.url)
    let p = decodeURIComponent(u.pathname)
    if (p === '/' || p === '') p = '/index.html'
    const file = path.normalize(path.join(root, p))
    if (!file.startsWith(root)) return new Response('forbidden', { status: 403 })
    return net.fetch(pathToFileURL(file).toString(), { headers: req.headers })
  })
  Menu.setApplicationMenu(null)
  const win = new BrowserWindow({
    width: 1600, height: 900, backgroundColor: '#000', title: 'A Rainy Place to Die', autoHideMenuBar: true,
    webPreferences: { backgroundThrottling: false },
  })
  win.webContents.on('before-input-event', (e, i) => {
    if (i.type === 'keyDown' && i.key === 'F11') { win.setFullScreen(!win.isFullScreen()); e.preventDefault() }
  })
  win.loadURL('app://game/' + (process.argv.find((a) => a.startsWith('?')) ?? ''))
})
app.on('window-all-closed', () => app.quit())
