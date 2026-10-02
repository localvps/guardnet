import { useEffect } from 'react';
import { useStore, setState, getState } from '../lib/store.js';
import { closeChat, settings } from '../lib/actions.js';
import { cx } from '../lib/format.jsx';
import Sidebar from './Sidebar.jsx';
import ChatView from './Chat.jsx';
import InfoPanel from './Info.jsx';
import Modals from './Modals.jsx';
import { ContextMenu, Dialog } from './overlay.jsx';
import CallLayer from './Calls.jsx';
import StoryViewer from './Stories.jsx';
import MediaViewer from './Viewer.jsx';
import { Logo } from './ui.jsx';

export default function Messenger() {
  const active = useStore((s) => s.active);
  const panel = useStore((s) => s.panel);
  const wall = useStore((s) => s.me?.settings?.wallpaper || 'gradient');
  useEffect(() => {
    const key = (e) => {
      if (e.key === 'Escape' && !getState().modal && !getState().ctx && !getState().dialog && !getState().viewer && !getState().storyView) {
        const st = getState();
        if (st.select) setState({ select: null });
        else if (st.panel) setState({ panel: null });
        else if (st.active && !document.activeElement?.closest?.('.composer')) closeChat();
      }
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, []);
  // auto-lock after inactivity when a passcode is set
  useEffect(() => {
    let t;
    const reset = () => {
      clearTimeout(t);
      const s = settings();
      if (s.passcode && s.autolock > 0) t = setTimeout(() => setState({ phase: 'locked' }), s.autolock * 60e3);
    };
    const evs = ['pointerdown', 'keydown', 'wheel', 'touchstart'];
    evs.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    reset();
    return () => { clearTimeout(t); evs.forEach((e) => window.removeEventListener(e, reset)); };
  }, []);
  return (
    <div className={cx('messenger', active && 'has-chat', panel && 'has-panel')}>
      <Sidebar />
      <main className="chat-area">
        <div className={cx('wallpaper', `wp-${wall}`)} aria-hidden="true"><div className="wp-dots" /></div>
        {active ? <ChatView key={active} id={active} /> : (
          <div className="no-chat">
            <div className="no-chat-card glass">
              <Logo size={72} />
              <div className="nc-title">به GuardNet خوش آمدید</div>
              <div className="nc-sub">یک گفتگو را از فهرست انتخاب کنید یا گفتگوی تازه‌ای شروع کنید.</div>
            </div>
          </div>
        )}
      </main>
      {panel && <InfoPanel />}
      <Modals />
      <Dialog />
      <ContextMenu />
      <CallLayer />
      <StoryViewer />
      <MediaViewer />
    </div>
  );
}
