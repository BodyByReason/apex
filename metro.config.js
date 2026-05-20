const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

const defaultResolveRequest =
  config.resolver.resolveRequest ||
  ((context, moduleName, platform) =>
    context.resolveRequest(context, moduleName, platform));

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (
    moduleName === 'livekit-client' ||
    moduleName.startsWith('livekit-client/')
  ) {
    return {
      filePath: path.join(
        __dirname,
        'node_modules',
        'livekit-client',
        'dist',
        'livekit-client.umd.js'
      ),
      type: 'sourceFile',
    };
  }

  return defaultResolveRequest(context, moduleName, platform);
};

module.exports = config;
