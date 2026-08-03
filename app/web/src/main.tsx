import { montaCancello } from './avvio.js';
import './styles.css';

const radice = document.getElementById('root');
if (!radice) throw new Error('elemento #root mancante');

montaCancello(radice);
