import { createRoot } from 'react-dom/client';
import 'maplibre-gl/dist/maplibre-gl.css';
import '../style.css';
import './server-field.css';
import ServerFieldApp from './ServerFieldApp.jsx';

createRoot(document.getElementById('root')).render(<ServerFieldApp />);
