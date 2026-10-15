'use strict';

module.exports = {
  appId: 'com.mertdemirtas.singularity',
  productName: 'Singularity',
  directories: { output: 'release' },
  // Theia and its native modules run in the bundled Node runtime, not Electron.
  // Keep physical paths available to that process and preserve its Node ABI.
  asar: false,
  npmRebuild: false,
  files: [
    'electron/**/*', 'assets/singularity-icon.png', 'lib/**/*', 'plugins/**/*',
    'extensions/plain-editor-ui/**/*', 'package.json', 'LICENSE',
    '!**/*.map', '!**/*.map.gz', '!**/*.log', '!**/tests/**', '!**/test/**',
    '!**/*.ts', '!**/node_modules/electron/**'
  ],
  extraResources: [{ from: '.release-runtime', to: 'runtime', filter: ['**/*', '!after-install.sh'] }],
  artifactName: 'Singularity-${version}-${os}-${arch}.${ext}',
  publish: { provider: 'github', owner: 'mertdemirtas', repo: 'Singularity', releaseType: 'release' },
  win: { target: ['nsis'], icon: 'assets/singularity-icon.png' },
  nsis: { oneClick: true, perMachine: false, allowElevation: true, deleteAppDataOnUninstall: false },
  mac: {
    target: ['dmg', 'zip'], category: 'public.app-category.developer-tools',
    icon: 'assets/singularity-icon.png',
    // A developer identity is supplied through CSC_LINK in the release workflow.
    ...(process.env.CSC_LINK ? {} : { identity: '-', hardenedRuntime: false }),
    binaries: ['Contents/Resources/runtime/bin/node'],
    extendInfo: {
      SUPublicEDKey: require('./assets/update-key.json').sparklePublicKey,
      SUFeedURL: `https://github.com/mertdemirtas/Singularity/releases/latest/download/appcast-${process.arch}.xml`,
      SUEnableAutomaticChecks: false,
      SUVerifyUpdateBeforeExtraction: true
    }
  },
  linux: { target: ['deb'], executableName: 'singularity', category: 'Development', icon: 'assets/singularity-icon.png',
    desktop: { entry: { StartupWMClass: 'Singularity', Keywords: 'text;editor;code;' } } },
  deb: { afterInstall: '.release-runtime/after-install.sh',
    depends: ['libgtk-3-0', 'libnotify4', 'libnss3', 'libxss1', 'libxtst6', 'xdg-utils',
      'libatspi2.0-0', 'libuuid1', 'libsecret-1-0', 'pkexec'] }
};
