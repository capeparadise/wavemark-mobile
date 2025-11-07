/* ========================================================================
   File: components/RatingModal.tsx
   PURPOSE: Cross-platform rating modal (1–5 stars).
   ======================================================================== */
import React, { useEffect, useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';

type Props = {
  visible: boolean;
  title?: string;
  initial?: number;           // 1..5
  onCancel: () => void;
  onSubmit: (stars: number) => void;
};

function Star({ filled, onPress }: { filled: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={{ padding: 6 }}>
      <Text style={{ fontSize: 28 }}>{filled ? '★' : '☆'}</Text>
    </Pressable>
  );
}

export default function RatingModal({ visible, title = 'Rate', initial = 0, onCancel, onSubmit }: Props) {
  const [value, setValue] = useState(initial);
  useEffect(() => setValue(initial), [initial]);

  return (
    <Modal animationType="slide" transparent visible={visible} onRequestClose={onCancel}>
      <View
        style={{
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.25)',
          justifyContent: 'flex-end',
        }}
      >
        <View
          style={{
            backgroundColor: 'white',
            borderTopLeftRadius: 16,
            borderTopRightRadius: 16,
            padding: 16,
            gap: 12,
          }}
        >
          <Text style={{ fontSize: 18, fontWeight: '700' }}>{title}</Text>

          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            {[1, 2, 3, 4, 5].map((i) => (
              <Star key={i} filled={i <= value} onPress={() => setValue(i)} />
            ))}
          </View>

          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 12, marginTop: 6 }}>
            <Pressable onPress={onCancel}>
              <Text style={{ padding: 10 }}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={() => onSubmit(value || 1)}
              style={{ backgroundColor: '#111827', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10 }}
            >
              <Text style={{ color: 'white', fontWeight: '700' }}>Save</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
