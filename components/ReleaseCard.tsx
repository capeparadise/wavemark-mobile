import React from 'react';
import { View, Text, Image, StyleSheet, TouchableOpacity } from 'react-native';

export default function ReleaseCard({ title, artist, image, onPress }: any) {
  return (
    <TouchableOpacity style={styles.card} onPress={onPress}>
      {image && <Image source={{ uri: image }} style={styles.image} />}
      <View style={styles.info}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.artist}>{artist}</Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    backgroundColor: '#111',
    padding: 12,
    marginBottom: 10,
    borderRadius: 8,
    alignItems: 'center'
  },
  image: {
    width: 60,
    height: 60,
    borderRadius: 6,
    marginRight: 12
  },
  info: {
    flex: 1
  },
  title: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold'
  },
  artist: {
    color: '#aaa',
    fontSize: 14
  }
});
