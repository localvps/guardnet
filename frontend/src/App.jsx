import { useEffect } from 'react';
import { useStore } from './lib/store.js';
import { boot } from './lib/actions.js';
import Auth from './components/Auth.jsx';
import Messenger from './components/Messenger.jsx';
import Lock from './components/Lock.jsx';
import { Toasts, Logo, Spinner } from './components/ui.jsx';

export default function App() {
  const phase = useStore((s) => s.phase);
  useEffect(() => { boot(); }, []);
  return (
    <>
      {phase === 'boot' && (
        <div className="splash"><Logo size={88} /><Spinner size={26} /></div>
      )}
      {phase === 'auth' && <Auth />}
      {phase === 'locked' && <Lock />}
      {phase === 'app' && <Messenger />}
      <Toasts />
    </>
  );
}
