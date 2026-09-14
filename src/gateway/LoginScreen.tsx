import { useId, useState, type FormEvent } from 'react';
import pandaBadge from '../assets/brand/panda-badge.png';
import { useI18n } from '../i18n/context';
import './LoginScreen.css';

export type LoginNoticeKind = 'info' | 'error';

export type LoginBusyState = 'idle' | 'submitting';

/**
 * The PadawanOS login screen (Phase 3, requirement #4): plain semantic HTML
 * rather than the Astryx design-system inputs used elsewhere in Panda —
 * deliberately, so the password field's font-size and touch target sizing
 * can be guaranteed (requirement #5) rather than inherited from a compact
 * desktop-first component library default. GatewayGate owns all the actual
 * session logic; this component is pure presentation + form wiring.
 */
export function LoginScreen({
  busy,
  notice,
  noticeKind,
  onSubmit,
}: {
  busy: LoginBusyState;
  /** Pre-resolved, localized text: invalid/throttled/unavailable/session-expired. */
  notice: string | null;
  noticeKind: LoginNoticeKind;
  onSubmit(password: string): void;
}) {
  const { t } = useI18n();
  const [password, setPassword] = useState('');
  const passwordId = useId();
  const noticeId = useId();
  const submitting = busy === 'submitting';

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting || password.length === 0) return;
    onSubmit(password);
  };

  return (
    <div className="gw-login-screen">
      <form className="gw-login-card" onSubmit={handleSubmit} aria-describedby={notice ? noticeId : undefined}>
        <div className="gw-login-brand">
          <img src={pandaBadge} alt="" className="gw-login-badge" />
          <h1 className="gw-login-title">{t('gateway.title')}</h1>
          <p className="gw-login-tagline">{t('gateway.tagline')}</p>
        </div>

        {notice && (
          <p
            id={noticeId}
            role="alert"
            className={`gw-login-notice ${noticeKind === 'error' ? 'gw-login-notice--error' : 'gw-login-notice--info'}`}
          >
            {notice}
          </p>
        )}

        <div className="gw-login-field">
          <label htmlFor={passwordId} className="gw-login-label">
            {t('gateway.passwordLabel')}
          </label>
          <input
            id={passwordId}
            name="password"
            type="password"
            className="gw-login-input"
            autoComplete="current-password"
            placeholder={t('gateway.passwordPlaceholder')}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={submitting}
            required
            // The only interactive element on the whole screen.
            autoFocus
          />
        </div>

        <button type="submit" className="gw-login-submit" disabled={submitting || password.length === 0}>
          {submitting ? t('gateway.signingIn') : t('gateway.signIn')}
        </button>
      </form>
    </div>
  );
}
