
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

// NOTE: React.StrictMode is deliberately not used here.
//
// StrictMode double-invokes mount effects in development. react-leaflet v5 does
// not survive that: MapContainer's cleanup calls map.remove(), which tears down
// Leaflet's control corners, and the immediate re-mount then throws
// "Cannot read properties of undefined (reading 'appendChild' / 'topright')".
// With two maps on screen (opening an event over the discovery map) the errors
// cascade and unmount the entire React tree — the app goes blank in dev.
//
// Production builds were never affected, so this only ever cost us the extra
// dev-time warnings. If react-leaflet fixes its StrictMode handling, put it back.
const root = ReactDOM.createRoot(rootElement);
root.render(<App />);
