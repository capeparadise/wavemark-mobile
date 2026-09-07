import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { ensureMyProfile } from '../lib/profileSocial';
import { useSession } from '../lib/session';
import { useTheme } from '../theme/useTheme';

const promptKey = (userId: string) => `ripple:listener-profile-prompt:v1:${userId}`;

export default function ProfileSetupPrompt() {
  const { colors } = useTheme();
  const { user } = useSession();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const userId = user?.id;
    if (!userId) {
      setVisible(false);
      return;
    }

    let active = true;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const alreadyShown = await AsyncStorage.getItem(promptKey(userId));
          if (!active || alreadyShown === '1') return;

          const profile = await ensureMyProfile();
          if (!active || !profile || profile.profile_setup_completed) return;

          // Record presentation rather than the button choice: this is deliberately
          // a one-time nudge, while the Profile banner remains until setup is done.
          await AsyncStorage.setItem(promptKey(userId), '1');
          if (active) setVisible(true);
        } catch {
          // The permanent Profile reminder is the fallback if this nudge cannot load.
        }
      })();
    }, 650);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [user?.id]);

  const close = () => setVisible(false);
  const startSetup = () => {
    close();
    router.push('/profile/setup');
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={close}
    >
      <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 24, backgroundColor: 'rgba(5, 7, 14, 0.72)' }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close profile setup prompt" onPress={close} style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }} />
        <View
          accessibilityViewIsModal
          style={{
            borderRadius: 24,
            borderWidth: 1,
            borderColor: colors.border.subtle,
            backgroundColor: colors.bg.secondary,
            padding: 22,
            gap: 18,
            shadowColor: '#000',
            shadowOpacity: 0.3,
            shadowRadius: 24,
            shadowOffset: { width: 0, height: 12 },
            elevation: 14,
          }}
        >
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <View style={{ width: 54, height: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent.primary + '20' }}>
              <Ionicons name="at" size={26} color={colors.accent.primary as any} />
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Not now" onPress={close} hitSlop={10} style={({ pressed }) => ({ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg.muted, opacity: pressed ? 0.75 : 1 })}>
              <Ionicons name="close" size={19} color={colors.text.muted as any} />
            </Pressable>
          </View>

          <View style={{ gap: 7 }}>
            <Text style={{ color: colors.text.secondary, fontSize: 23, fontWeight: '900' }}>Make your profile yours</Text>
            <Text style={{ color: colors.text.muted, fontSize: 15, lineHeight: 21 }}>
              Choose a unique @username so people can find and follow you. Your display name is already filled in, and you decide whether your music is public or private.
            </Text>
          </View>

          <View style={{ gap: 10 }}>
            <Pressable accessibilityRole="button" onPress={startSetup} style={({ pressed }) => ({ minHeight: 50, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent.primary, opacity: pressed ? 0.84 : 1 })}>
              <Text style={{ color: colors.text.inverted, fontSize: 15, fontWeight: '900' }}>Set up profile</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={close} style={({ pressed }) => ({ minHeight: 42, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.7 : 1 })}>
              <Text style={{ color: colors.text.muted, fontWeight: '800' }}>Not now</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
