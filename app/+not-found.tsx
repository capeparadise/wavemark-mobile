import { Link, Stack } from 'expo-router';
import { StyleSheet, Text } from 'react-native';
import Screen from '../components/Screen';
import { useTheme } from '../theme/useTheme';

export default function NotFoundScreen() {
  const { colors } = useTheme();

  return (
    <>
      <Stack.Screen options={{ title: 'Oops!' }} />
      <Screen edges={['left', 'right']}>
        <Text style={[styles.title, { color: colors.text.secondary }]}>
          This screen does not exist.
        </Text>
        <Link href="/" style={[styles.link, { color: colors.accent.primary }]}>
          Go to home screen!
        </Link>
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
  },
  link: {
    marginTop: 15,
    paddingVertical: 15,
    fontWeight: '700',
  },
});
