import './styles.css';
import { createApp } from './App';

const app = createApp();
const root = document.getElementById('app');
if (root) {
  root.appendChild(app);
}
