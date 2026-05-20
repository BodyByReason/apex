// 1. Standard entry-point setup imports
import 'react-native-gesture-handler';
import 'react-native-url-polyfill/auto';

// Background task definitions must be imported before the app suspends.
import './src/tasks/walkLocationTask';

import { registerRootComponent } from 'expo';
import App from './App';

registerRootComponent(App);
