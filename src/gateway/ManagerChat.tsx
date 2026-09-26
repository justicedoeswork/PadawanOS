import { useState, type FormEvent } from 'react';
import { Send, X } from 'lucide-react';
import justiceOsMark from '../assets/brand/justiceos-mark.png';
import { useI18n } from '../i18n/context';
import { askManager } from './managerCommunications';
import './ManagerChat.css';

type ChatMessage = { role: 'user' | 'manager'; text: string };

export function ManagerChat() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: 'manager', text: t('manager.readyBody') }
  ]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const question = input.trim();
    if (!question || busy) return;
    setInput('');
    setMessages((current) => [...current, { role: 'user', text: question }]);
    setBusy(true);
    try {
      const reply = await askManager(question);
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
