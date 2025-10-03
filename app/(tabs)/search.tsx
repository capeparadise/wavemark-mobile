// app/(tabs)/search.tsx
import { Link } from "expo-router";
import { useEffect, useState } from "react";
import {
    ActivityIndicator,
    Image,
    Pressable,
    SafeAreaView,
    ScrollView,
    Text,
    TextInput,
    View,
} from "react-native";
import {
    AppleArtist,
    getArtistThumb,
    searchArtists,
} from "../../lib/apple"; // top-level lib

type Mode = "artists" | "albums";

export default function SearchScreen() {
  const [mode, setMode] = useState<Mode>("artists");
  const [q, setQ] = useState("justin bieber");
  const [loading, setLoading] = useState(false);
  const [artists, setArtists] = useState<
    (AppleArtist & { thumb?: string | null })[]
  >([]);

  async function runSearch(text: string) {
    setLoading(true);
    try {
      if (mode === "artists") {
        const list = await searchArtists(text);
        // Attach small avatar (album artwork) for the top few results
        const top8 = await Promise.all(
          list.slice(0, 8).map(async (a) => ({
            ...a,
            thumb: await getArtistThumb(a.artistId).catch(() => null),
          }))
        );
        setArtists([...top8, ...list.slice(8)]);
      } else {
        // albums tab can be implemented later
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    runSearch(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#fff" }}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
        {/* Toggle */}
        <View style={{ flexDirection: "row", gap: 10 }}>
          <Pressable
            onPress={() => setMode("artists")}
            style={{
              paddingHorizontal: 14,
              paddingVertical: 8,
              borderRadius: 18,
              backgroundColor: mode === "artists" ? "#000" : "#f2f2f2",
            }}
          >
            <Text style={{ color: mode === "artists" ? "#fff" : "#000" }}>
              Artists
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setMode("albums")}
            style={{
              paddingHorizontal: 14,
              paddingVertical: 8,
              borderRadius: 18,
              backgroundColor: mode === "albums" ? "#000" : "#f2f2f2",
            }}
          >
            <Text style={{ color: mode === "albums" ? "#fff" : "#000" }}>
              Albums
            </Text>
          </Pressable>
        </View>

        {/* Search box */}
        <TextInput
          value={q}
          onChangeText={(t) => {
            setQ(t);
            runSearch(t);
          }}
          placeholder="Search for an artist"
          style={{
            borderWidth: 1,
            borderColor: "#e5e5e5",
            padding: 12,
            borderRadius: 12,
          }}
        />

        {loading && (
          <View style={{ padding: 20, alignItems: "center" }}>
            <ActivityIndicator />
          </View>
        )}

        {/* Artist results */}
        {!loading &&
          mode === "artists" &&
          artists.map((a) => (
            <Link
              key={a.artistId}
              href={{
                pathname: "/artist/[id]",
                params: { id: a.artistId, name: a.name },
              }}
              asChild
            >
              <Pressable
                style={{
                  flexDirection: "row",
                  gap: 12,
                  borderWidth: 1,
                  borderColor: "#eee",
                  borderRadius: 12,
                  padding: 12,
                  alignItems: "center",
                }}
              >
                {a.thumb ? (
                  <Image
                    source={{ uri: a.thumb }}
                    style={{ width: 56, height: 56, borderRadius: 8 }}
                  />
                ) : (
                  <View
                    style={{
                      width: 56,
                      height: 56,
                      borderRadius: 8,
                      backgroundColor: "#f2f2f2",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Text>🎵</Text>
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 16, fontWeight: "700" }}>
                    {a.name}
                  </Text>
                  {!!a.primaryGenreName && (
                    <Text style={{ opacity: 0.7 }}>{a.primaryGenreName}</Text>
                  )}
                </View>
                <Text style={{ color: "#2f6" }}>View →</Text>
              </Pressable>
            </Link>
          ))}
      </ScrollView>
    </SafeAreaView>
  );
}
