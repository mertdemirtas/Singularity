'use strict';

module.exports = {
  appId: 'com.mertdemirtas.singularity',
  productName: 'Singularity',
  directories: { output: 'release' },
  // Theia and its native modules run in the bundled Node runtime, not Electron.
  // Keep physical paths available to that process and preserve its Node ABI.
  asar: false,
  npmRebuild: false,
  // The legacy NSIS 3.0 compiler cannot opt into Windows long paths.
  toolsets: { nsis: '1.2.1' },
  files: [
    'electron/**/*', 'assets/singularity-icon.png', 'lib/**/*', 'plugins/**/*',
    'extensions/plain-editor-ui/**/*', 'package.json', 'LICENSE',
    '!**/*.map', '!**/*.map.gz', '!**/*.log', '!**/tests/**', '!**/test/**',
    '!**/*.ts', '!**/node_modules/electron/**'
  ],
  extraResources: [{ from: '.release-runtime', to: 'runtime', filter: ['**/*', '!after-install.sh', '!icons', '!icons/**/*'] }],
  artifactName: 'Singularity-${version}-${os}-${arch}.${ext}',
  publish: { provider: 'github', owner: 'mertdemirtas', repo: 'Singularity', releaseType: 'release' },
  win: { target: ['nsis'], icon: 'assets/singularity-icon.png' },
  nsis: { oneClick: true, perMachine: false, allowElevation: true, deleteAppDataOnUninstall: false,
    include: 'build/installer.nsh' },
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
  linux: { target: ['deb'], executableName: 'singularity-editor', category: 'Development', icon: '.release-runtime/icons',
    desktop: { entry: { StartupWMClass: 'Singularity', Keywords: 'text;editor;code;' } } },
  // Ubuntu already ships an unrelated game named singularity. Keep every Linux
  // package/launcher/icon identifier distinct so system upgrades cannot replace us.
  deb: { packageName: 'singularity-editor', afterInstall: '.release-runtime/after-install.sh',
    fpm: ['--conflicts', 'singularity (<= 0.1.3)', '--replaces', 'singularity (<= 0.1.3)'],
    depends: ['libgtk-3-0', 'libnotify4', 'libnss3', 'libxss1', 'libxtst6', 'xdg-utils',
      'libatspi2.0-0', 'libuuid1', 'libsecret-1-0', 'pkexec'] }
};
