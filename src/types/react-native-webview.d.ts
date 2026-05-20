/**
 * Temporary type stub for react-native-webview.
 * Replace by running: npx expo install react-native-webview
 * Then rebuild your dev client. This stub keeps TypeScript happy in the meantime.
 */
declare module 'react-native-webview' {
  import React from 'react';
  import { StyleProp, ViewStyle } from 'react-native';

  export interface WebViewProps {
    source?: { uri?: string; html?: string };
    style?: StyleProp<ViewStyle>;
    allowsInlineMediaPlayback?: boolean;
    mediaPlaybackRequiresUserAction?: boolean;
    javaScriptEnabled?: boolean;
    domStorageEnabled?: boolean;
    scrollEnabled?: boolean;
    bounces?: boolean;
    backgroundColor?: string;
    onLoadEnd?: () => void;
    onError?: (event: any) => void;
  }

  const WebView: React.ComponentType<WebViewProps>;
  export default WebView;
}
