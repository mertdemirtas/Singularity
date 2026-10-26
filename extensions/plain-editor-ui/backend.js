'use strict';

const path = require('node:path');
const { ContainerModule } = require('@theia/core/shared/inversify');
const { BackendApplicationContribution, EarlyExpressMiddleware } = require('@theia/core/lib/node/backend-application');
const { PluginScanner } = require('@theia/plugin-ext/lib/common/plugin-protocol');

module.exports = new ContainerModule(bind => {
  require('./ssh-backend')(bind);
  bind(BackendApplicationContribution).toDynamicValue(({ container }) => ({
    initialize() {
      if (process.env.SINGULARITY_DESKTOP === '1') {
        const { WebsocketFrontendConnectionService } = require('@theia/core/lib/node/messaging/websocket-frontend-connection-service');
        require('./desktop-connections.cjs').retainDesktopConnections(container.get(WebsocketFrontendConnectionService));
      }
      container.get(EarlyExpressMiddleware).handlers.push((request, response, next) => {
        // Theia's gzip lookup treats a cache-busting query as part of the
        // filename. Preserve the browser's hashed URL while fixing that lookup.
        if (/^\/(?:bundle|secondary-window)\.(?:js|css)\?v=[a-f0-9]{12}$/.test(request.url)) {
          request.url = request.url.split('?')[0];
          response.vary('Accept-Encoding');
        }
        next();
      });
      const scanner = container.getAll(PluginScanner).find(value => value.apiType === 'vscode');
      if (!scanner) throw new Error('Singularity: VS Code extension scanner is unavailable.');
      const getLifecycle = scanner.getLifecycle.bind(scanner);
      scanner.getLifecycle = plugin => {
        const lifecycle = getLifecycle(plugin);
        if (['github.vscode-pull-request-github', 'vscode.git'].includes(`${plugin.publisher}.${plugin.name}`.toLowerCase())) {
          lifecycle.backendInitPath = path.join(process.cwd(), 'extensions/plain-editor-ui/plugin-init.cjs');
        }
        return lifecycle;
      };
    }
  })).inSingletonScope();
});
module.exports.default = module.exports;
