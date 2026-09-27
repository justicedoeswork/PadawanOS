import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Send, X } from 'lucide-react';
import justiceOsMark from '../assets/brand/justiceos-mark.png';
import { useI18n } from '../i18n/context';
import {
  askManager,
  getManagerSnapshot,
  summarizeSnapshot,
  type ManagerContext,
  type ManagerIntent,
  type ManagerSnapshot,
} from './managerCommunications';
import { appendManagerTurn, loadManagerTurns, openManagerConversation } from './managerPersistence';
import './ManagerChat.css';

type ChatMessage = { role: 'user' | 'manager'; text: string };

const SNAPSHOT_STORAGE_KEY = 'justiceos.manager.lastSnapshot';
const POLL_INTERVAL_MS = 60_000;

function readStoredSnapshot(): ManagerSnapshot | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(SNAPSHOT_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as ManagerSnapshot;
  } catch {
    return null;
  }
}

function storeSnapshot(snapshot: ManagerSnapshot): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SNAPSHOT_STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // localStorage is an enhancement only; chat remains functional without it.
  }
}

function meaningfulIncrease(previous: ManagerSnapshot | null, current: ManagerSnapshot): boolean {
  if (!previous) return false;
  return (
    current.urgent > previous.urgent ||
    current.overdue > previous.overdue ||
    current.today > previous.today ||
    current.replies > previous.replies ||
    current.approvals > previous.approvals
  );
}

export function ManagerChat() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [unreadUpdate, setUnreadUpdate] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: 'manager', text: t('manager.readyBody') }
  ]);
  const contextRef = useRef<ManagerContext>({});
  const lastSnapshotRef = useRef<ManagerSnapshot | null>(readStoredSnapshot());

  async function refreshCatchUp({ announce }: { announce: boolean }) {
    try {
      const snapshot = await getManagerSnapshot();
      const previous = lastSnapshotRef.current;

      if (announce && !previous) {
        setMessages((current) => [...current, { role: 'manager', text: summarizeSnapshot(snapshot) }]);
      } else if (announce && previous && snapshot.signature !== previous.signature) {
        setMessages((current) => [...current, { role: 'manager', text: `Quick update: ${summarizeSnapshot(snapshot)}` }]);
      } else if (meaningfulIncrease(previous, snapshot)) {
        setUnreadUpdate(true);
      }

      lastSnapshotRef.current = snapshot;
      storeSnapshot(snapshot);
    } catch {
      // Background catch-up must never turn a temporary integration outage
      // into a visible error loop. Explicit user questions still surface errors.
    }
  }

  useEffect(() => {
    const timer = window.setInterval(() => {
      void refreshCatchUp({ announce: open });
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setUnreadUpdate(false);
    void refreshCatchUp({ announce: true });
  }, [open]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const question = input.trim();
    if (!question || busy) return;
    setInput('');
    setMessages((current) => [...current, { role: 'user', text: question }]);
    setBusy(true);
    try {
      const reply = await askManager(question, contextRef.current);
      if (reply.intent.kind !== 'explain' && reply.intent.kind !== 'repeat' && reply.intent.kind !== 'help') {
        contextRef.current = { lastIntent: reply.intent, lastReply: reply.text };
      }
      setMessages((current) => [...current, { role: 'manager', text: reply.text }]);
    } catch {
      setMessages((current) => [...current, { role: 'manager', text: t('manager.error') }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="gw-manager-fab"
        aria-label={t('manager.openTooltip')}
        title={t('manager.openTooltip')}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <img src={justiceOsMark} alt="" className="gw-manager-fab-icon" />
        {unreadUpdate && <span className="gw-manager-update-dot" aria-label={t('manager.newUpdate')} />}
      </button>

      {open && (
        <div className="gw-manager-panel" role="dialog" aria-modal="true" aria-label={t('manager.panelTitle')}>
          <div className="gw-manager-panel-header">
            <span className="gw-manager-panel-title">{t('manager.panelTitle')}</span>
            <button
              type="button"
              className="gw-manager-panel-close"
              aria-label={t('manager.panelClose')}
              onClick={() => setOpen(false)}
            >
              <X size={16} />
            </button>
          </div>

          <div className="gw-manager-transcript" aria-live="polite">
            {messages.map((message, index) => (
              <div key={index} className={`gw-manager-message gw-manager-message-${message.role}`}>
                {message.text.split('\n').map((line, lineIndex) => (
                  <span key={lineIndex}>
                    {line}
                    {lineIndex < message.text.split('\n').length - 1 ? <br /> : null}
                  </span>
                ))}
              </div>
            ))}
            {busy && <div className="gw-manager-message gw-manager-message-manager">{t('manager.working')}</div>}
          </div>

          <form className="gw-manager-form" onSubmit={submit}>
            <input
              className="gw-manager-input"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder={t('manager.placeholder')}
              aria-label={t('manager.placeholder')}
              disabled={busy}
            />
            <button className="gw-manager-send" type="submit" disabled={busy || input.trim().length === 0} aria-label={t('manager.send')}>
              <Send size={16} />
            </button>
          </form>
          <p className="gw-manager-readonly">{t('manager.readOnly')}</p>
        </div>
      )}
    </>
  );
}
