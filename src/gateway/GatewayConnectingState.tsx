import justiceOsMark from '../assets/brand/gateway-presentation/justiceos-mark-color.svg';
import { useI18n } from '../i18n/context';
import './GatewayConnectingState.css';

/**
 * Replaces EmptyState's onboarding copy ("Watch a demo", "Connect your
 * agent", ACP developer instructions) in the gateway build's agent-chat
 * view. Those all describe features that don't exist here -- the managed
 * Insurance Audit Agent connection dials itself (see managedAgent.ts) --
 * so this is just an honest, brief "still connecting" status rather than
 * generic client onboarding.
 */
export function GatewayConnectingState() {
  const { t } = useI18n();
  return (
    <div className="gw-connecting" role="status" aria-live="polite">
      <img src={justiceOsMark} alt="" className="gw-connecting-mark" aria-hidden="true" />
      <p className="gw-connecting-title">{t('gateway.connectingTitle')}</p>
      <p className="gw-connecting-body">{t('gateway.connectingBody')}</p>
    </div>
  );
}
