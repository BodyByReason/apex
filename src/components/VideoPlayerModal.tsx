/**
 * VideoPlayerModal.tsx
 *
 * In-app YouTube player using react-native-webview.
 * The video loads in an iframe inside a bottom-sheet modal — users never
 * leave the APEX app and the YouTube app is never invoked.
 *
 * SETUP (one-time):
 *   npx expo install react-native-webview
 *   Then rebuild your dev client.
 */

import React from 'react';
import {
  ActivityIndicator,
  Animated,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import WebView from 'react-native-webview';

import { apexColors as C } from '@/theme/colors';

type Props = {
  actionLabel?: string;
  actionLoading?: boolean;
  actionTint?: string;
  onAction?: () => void;
  visible: boolean;
  videoUrl?: string;
  youtubeId: string;
  title?: string;
  onClose: () => void;
};

export function VideoPlayerModal({ actionLabel, actionLoading = false, actionTint, onAction, visible, videoUrl, youtubeId, title, onClose }: Props) {
  const [loading, setLoading] = React.useState(true);
  const sheetY = React.useRef(new Animated.Value(0)).current;

  // Reset loading state each time a new video opens
  React.useEffect(() => {
    if (visible) setLoading(true);
  }, [visible, youtubeId, videoUrl]);

  React.useEffect(() => {
    if (!visible) {
      sheetY.setValue(0);
    }
  }, [sheetY, visible]);

  const dismissSheet = React.useCallback(() => {
    sheetY.setValue(0);
    onClose();
  }, [onClose, sheetY]);

  const panResponder = React.useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gestureState) => Math.abs(gestureState.dy) > 5 && Math.abs(gestureState.dy) > Math.abs(gestureState.dx),
        onPanResponderMove: (_, gestureState) => {
          sheetY.setValue(Math.max(0, gestureState.dy));
        },
        onPanResponderRelease: (_, gestureState) => {
          if (gestureState.dy > 80 || gestureState.vy > 0.8) {
            Animated.timing(sheetY, {
              toValue: 500,
              duration: 180,
              useNativeDriver: true,
            }).start(() => dismissSheet());
            return;
          }

          Animated.spring(sheetY, {
            toValue: 0,
            useNativeDriver: true,
            bounciness: 6,
          }).start();
        },
      }),
    [dismissSheet, sheetY],
  );

  // Use youtube-nocookie for stricter privacy + better embed compatibility.
  // Wrap in a minimal HTML page so the WebView has a known origin (avoids Error 153).
  // A mobile Safari user-agent ensures YouTube serves the mobile embed player.
  const embedHtml = videoUrl
    ? `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  html, body { width:100%; height:100%; background:#000; overflow:hidden; }
  video { width:100%; height:100%; object-fit:contain; background:#000; }
</style>
</head>
<body>
<video
  src="${videoUrl}"
  controls
  autoplay
  playsinline
  webkit-playsinline
></video>
</body>
</html>`
    : `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  html, body { width:100%; height:100%; background:#000; overflow:hidden; }
  iframe { width:100%; height:100%; border:0; }
</style>
</head>
<body>
<iframe
  src="https://www.youtube-nocookie.com/embed/${youtubeId}?autoplay=1&rel=0&modestbranding=1&playsinline=1&fs=1&enablejsapi=1"
  allow="autoplay; fullscreen; accelerometer; gyroscope"
  allowfullscreen
  frameborder="0"
></iframe>
</body>
</html>`;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.overlay}>
        {/* Backdrop tap closes */}
        <Pressable style={styles.backdrop} onPress={onClose} />

        <Animated.View style={[styles.sheet, { transform: [{ translateY: sheetY }] }]} {...panResponder.panHandlers}>
          {/* Handle + header */}
          <View style={styles.header}>
            <View style={styles.handle} />
            <Text style={styles.title} numberOfLines={1}>
              {title ?? 'Exercise Demo'}
            </Text>
            <Pressable style={styles.closeBtn} onPress={onClose} hitSlop={12}>
              <Text style={styles.closeBtnText}>✕</Text>
            </Pressable>
          </View>

          {/* Video container — 16:9 */}
          <View style={styles.videoContainer}>
            {loading ? (
              <View style={styles.loadingOverlay}>
                <ActivityIndicator size="large" color={C.green} />
                <Text style={styles.loadingText}>Loading demo…</Text>
              </View>
            ) : null}
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            {React.createElement(WebView as any, {
              style: styles.webview,
              source: { html: embedHtml, baseUrl: 'https://www.youtube-nocookie.com' },
              allowsInlineMediaPlayback: true,
              allowsFullscreenVideo: true,
              mediaPlaybackRequiresUserAction: false,
              javaScriptEnabled: true,
              domStorageEnabled: true,
              originWhitelist: ['*'],
              userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
              onLoadEnd: () => setLoading(false),
              scrollEnabled: false,
              bounces: false,
              backgroundColor: '#000000',
            })}
          </View>

          {onAction && actionLabel ? (
            <Pressable
              style={[styles.actionBtn, actionTint ? { backgroundColor: actionTint } : null, actionLoading && { opacity: 0.7 }]}
              onPress={onAction}
              disabled={actionLoading}
            >
              {actionLoading ? (
                <ActivityIndicator size="small" color="#000" />
              ) : (
                <Text style={styles.actionBtnText}>{actionLabel}</Text>
              )}
            </Pressable>
          ) : null}

          <Pressable style={[styles.doneBtn, onAction && actionLabel ? { marginTop: 10 } : null]} onPress={onClose}>
            <Text style={styles.doneBtnText}>Done</Text>
          </Pressable>
        </Animated.View>
      </View>
    </Modal>
  );
}

const VIDEO_ASPECT = 9 / 16;
// Width = ~100% of screen; height derived from 16:9
const VIDEO_HEIGHT = Math.round(350 * VIDEO_ASPECT / 1) * (16 / 9); // ≈ 197px; overridden below

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'transparent',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.72)',
  },
  sheet: {
    backgroundColor: C.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    borderColor: C.border,
    paddingBottom: 32,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 10,
    gap: 8,
  },
  handle: {
    position: 'absolute',
    top: 8,
    alignSelf: 'center',
    width: 40,
    height: 4,
    backgroundColor: C.border,
    borderRadius: 2,
    left: '50%',
    marginLeft: -20,
  },
  title: {
    flex: 1,
    color: C.text,
    fontFamily: 'DMSans_500Medium',
    fontSize: 14,
    marginTop: 8,
  },
  closeBtn: {
    marginTop: 6,
    paddingHorizontal: 4,
  },
  closeBtnText: {
    color: C.muted,
    fontSize: 16,
  },
  videoContainer: {
    width: '100%',
    aspectRatio: 16 / 9,
    backgroundColor: '#000',
    position: 'relative',
  },
  webview: {
    flex: 1,
    backgroundColor: '#000',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    zIndex: 1,
  },
  loadingText: {
    color: C.muted,
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
  },
  actionBtn: {
    marginHorizontal: 16,
    marginTop: 14,
    minHeight: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.green,
  },
  actionBtnText: {
    color: '#000',
    fontFamily: 'DMSans_700Bold',
    fontSize: 14,
  },
  doneBtn: {
    marginHorizontal: 16,
    marginTop: 14,
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneBtnText: {
    color: C.text,
    fontFamily: 'DMSans_500Medium',
    fontSize: 14,
  },
});
