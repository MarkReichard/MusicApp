import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { groupLessonsByCategory, hydrateLessons, refreshLessonsFromWebService } from '../content/repository';
import { RootStackParamList } from '../navigation/types';
import { LessonProgressMap, loadLessonProgressMap } from '../storage/progress';

const LESSON_REFRESH_URL = 'https://example.com/musicapp/lessons.json';

const prettyCategory = (category: string) =>
  category
    .split('_')
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
    .join(' ');

export function LessonLibraryScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [lessons, setLessons] = useState<ReturnType<typeof groupLessonsByCategory>[string]>([]);
  const [refreshState, setRefreshState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [refreshErrorMessage, setRefreshErrorMessage] = useState<string | null>(null);
  const [progressMap, setProgressMap] = useState<LessonProgressMap>({});

  const loadProgress = async () => {
    const map = await loadLessonProgressMap();
    setProgressMap(map);
  };

  useEffect(() => {
    let mounted = true;
    async function load() {
      const hydrated = await hydrateLessons();
      if (mounted) {
        setLessons(hydrated);
      }
      await loadProgress();
    }

    void load();
    return () => {
      mounted = false;
    };
  }, []);

  const grouped = useMemo(() => groupLessonsByCategory(lessons), [lessons]);

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      void loadProgress();
    });
    return unsubscribe;
  }, [navigation]);

  const onRefresh = async () => {
    setRefreshState('loading');
    setRefreshErrorMessage(null);
    try {
      const updated = await refreshLessonsFromWebService(LESSON_REFRESH_URL);
      setLessons(updated);
      await loadProgress();
      setRefreshState('idle');
    } catch (error) {
      setRefreshState('error');
      const message = error instanceof Error ? error.message : 'Unknown refresh error';
      setRefreshErrorMessage(message);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Lesson Library</Text>
      <Text style={styles.subtitle}>Choose a lesson type and start training.</Text>
      <Pressable style={styles.refreshBtn} onPress={() => void onRefresh()}>
        <Text style={styles.refreshBtnText}>
          {refreshState === 'loading' ? 'Refreshing lessons…' : 'Refresh lessons from web service'}
        </Text>
      </Pressable>
      {refreshState === 'error' ? (
        <Text style={styles.errorText}>Unable to refresh lessons: {refreshErrorMessage}</Text>
      ) : null}

      {Object.entries(grouped).map(([category, lessons]) => (
        <View key={category} style={styles.section}>
          <Text style={styles.sectionTitle}>{prettyCategory(category)}</Text>
          {lessons
            .sort((a, b) => a.difficulty.localeCompare(b.difficulty) || a.name.localeCompare(b.name))
            .map((lesson) => (
              <Pressable
                key={lesson.id}
                style={styles.card}
                onPress={() => navigation.navigate('Trainer', { lessonId: lesson.id })}
              >
                <Text style={styles.lessonName}>{lesson.name}</Text>
                <Text style={styles.lessonMeta}>{lesson.difficulty}</Text>
                {progressMap[lesson.id] ? (
                  <Text style={styles.lessonStats}>
                    Attempts {progressMap[lesson.id].attempts} · Best {Math.round(progressMap[lesson.id].bestAccuracy)}%
                  </Text>
                ) : null}
              </Pressable>
            ))}
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    gap: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: 16,
    color: '#5f6368',
  },
  refreshBtn: {
    borderWidth: 1,
    borderColor: '#d0d7de',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  refreshBtnText: {
    fontWeight: '700',
    fontSize: 13,
  },
  errorText: {
    color: '#b91c1c',
    fontSize: 12,
  },
  section: {
    gap: 10,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  card: {
    borderWidth: 1,
    borderColor: '#d0d7de',
    borderRadius: 10,
    padding: 14,
    backgroundColor: '#fff',
  },
  lessonName: {
    fontSize: 16,
    fontWeight: '600',
  },
  lessonMeta: {
    marginTop: 4,
    fontSize: 13,
    color: '#6b7280',
    textTransform: 'capitalize',
  },
  lessonStats: {
    marginTop: 6,
    fontSize: 12,
    color: '#4b5563',
  },
});
