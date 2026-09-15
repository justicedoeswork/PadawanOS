import { useState } from 'react';
import { X } from 'lucide-react';
import justiceOsMark from '../assets/brand/justiceos-mark.png';
import { useI18n } from '../i18n/context';
import './ManagerChat.css';

/**
 * Floating Justice Manager chat button + placeholder panel (LAYOUT #3).
 * Phase 1 only: there is no manager backend yet, so this never claims to
 * be operational and never sends anything anywhere -- opening it just
 * shows a clearly-labeled placeholder. The standalone JusticeOS mark
 * (justiceos-mark.png -- a raster crop of the approved brand master, not
 * a vector) is the Justice Manager's avatar here, per the finalized
 * branding -- the earlier placeholder panda image is gone.
 */
export function ManagerChat() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

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
          <p className="gw-manager-panel-body">{t('manager.placeholderBody')}</p>
        </div>
      )}
    </>
  );
}
