import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { RootStackParamList } from './types';
import { LessonLibraryScreen } from '../screens/LessonLibraryScreen';
import { TrainerScreen } from '../screens/TrainerScreen';

const Stack = createNativeStackNavigator<RootStackParamList>();

export function AppNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="LessonLibrary" component={LessonLibraryScreen} />
      <Stack.Screen name="Trainer" component={TrainerScreen} />
    </Stack.Navigator>
  );
}
