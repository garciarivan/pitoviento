import { createRoot } from 'react-dom/client';
import maplibregl from 'maplibre-gl';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { PathLayer, ScatterplotLayer } from '@deck.gl/layers';
import 'maplibre-gl/dist/maplibre-gl.css';
import '../style.css';
import App from './App.jsx';

window.maplibregl = maplibregl;
window.deck = { MapboxOverlay, PathLayer, ScatterplotLayer };

createRoot(document.getElementById('root')).render(<App />);
