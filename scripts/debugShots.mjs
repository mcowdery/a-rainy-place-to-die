/**
 * Dev only: the dev server's own endpoints (F9 snapshots at /__shot, the scene editor's /__scene, ...).
 *
 * They live in scripts/devEndpoints.mjs, not here. vite.config.ts imports this file, and saving anything the config
 * imports restarts every dev server that's watching (the user's, mid-play); so this is only the door, and it loads
 * the endpoints through the server at each request: add or change one there and it's live, with no restart.
 * Leave this file alone.
 */
export function debugShots() {
  return {
    name: 'debug-shots',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url || !req.url.startsWith('/__')) return next();
        server.ssrLoadModule('/scripts/devEndpoints.mjs').then((m) => {
          if (!m.handle(server, req, res)) next();
        }).catch((err) => {
          res.statusCode = 500;
          res.end(String(err));
        });
      });
    },
  };
}
