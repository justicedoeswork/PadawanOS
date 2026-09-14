import { useEffect, type ReactNode } from 'react';
import { isGatewayBuild } from './buildMode';
import { useGatewayAuth } from './gatewayAuthStore';
import { LoginScreen } from './LoginScreen';
import { useI18n } from '../i18n/context';
import './LoginScreen.css';

/**
 * Wraps the whole app (main.tsx). In the GitHub Pages demo build this is a
 * complete no-op -- not just "renders children," but literally never calls
 * `isGatewayBuild()`'s consumer, `checkSession()`, so the demo build makes
 * zero requests to `/acp/session` or any other gateway route (requirement
 * #14). In the gateway build it gates the whole tree behind the JusticeOS
 * login screen until `GET /acp/session` (or a fresh login) confirms Austin
 * is authenticated.
 */
export function GatewayGate({ children }: { children: ReactNode }) {
  if (!isGatewayBuild()) return <>{children}</>;
  return <GatedApp>{children}</GatedApp>;
}

function GatedApp({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const phase = useGatewayAuth((s) => s.phase);
  const busy = useGatewayAuth((s) => s.busy);
  const notice = useGatewayAuth((s) => s.notice);
  const noticeKind = useGatewayAuth((s) => s.noticeKind);

  // Once per mount: the one place that actually calls GET /acp/session.
  useEffect(() => {
    void useGatewayAuth.getState().checkSession();
  }, []);

  if (phase === 'checking') {
    return (
      <div className="gw-login-screen" role="status" aria-live="polite">
        {t('gateway.checkingSession')}
      </div>
    );
  }

  if (phase === 'login') {
    return (
      <LoginScreen
        busy={busy ? 'submitting' : 'idle'}
        notice={notice}
        noticeKind={noticeKind}
        onSubmit={(password) => void useGatewayAuth.getState().login(password)}
      />
    );
  }

  return <>{children}</>;
}
