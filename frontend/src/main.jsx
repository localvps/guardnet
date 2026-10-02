import { createRoot } from 'react-dom/client';
import '@fontsource-variable/vazirmatn';
import './styles/base.css';
import './styles/auth.css';
import './styles/app.css';
import './styles/chat.css';
import './styles/panels.css';
import './styles/glass.css';
import App from './App.jsx';

createRoot(document.getElementById('root')).render(<App />);
