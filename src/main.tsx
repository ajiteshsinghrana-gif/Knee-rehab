import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import './ui/base.css';
import './ui/extra.css';

createRoot(document.getElementById('root')!).render(<App />);
