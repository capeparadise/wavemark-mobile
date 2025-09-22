import { Link } from 'expo-router';
import { SafeAreaView, Text, View } from 'react-native';

export default function HomeScreen() {
  return (
    <SafeAreaView style={{ flex: 1 }}>
      <View style={{ padding: 24, gap: 14 }}>
        <Text style={{ fontSize: 32, fontWeight: '800' }}>Wavemark</Text>
        <Text>Quick links</Text>
        <Link href="/upcoming" style={{ color: '#2563eb', fontSize: 18 }}>Upcoming</Link>
        <Link href="/listen" style={{ color: '#2563eb', fontSize: 18 }}>Listen list</Link>
        <Link href="/search" style={{ color: '#2563eb', fontSize: 18 }}>Search & import</Link>
        <Link href="/add-release" style={{ color: '#2563eb', fontSize: 18 }}>Add release (admin)</Link>
      </View>
    </SafeAreaView>
  );
}
