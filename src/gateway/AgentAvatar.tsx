import type { CSSProperties, ReactElement } from 'react';

/**
 * Reusable wizard-themed role-icon system (JusticeOS gateway build): every
 * managed agent gets its own small, distinct glyph from this shared visual
 * vocabulary (an enchanted scroll here; a spellbook, crystal orb, potion
 * vessel, rune, key, or compass are the obvious next entries) instead of a
 * generic shield/coat-of-arms. Adding a role here is how an agent gets its
 * own icon; nothing else about this component changes.
 */
export type AgentRole = 'insurance-audit' | 'marketing';

type GlyphProps = { size: number; className?: string; style?: CSSProperties };

export function AgentAvatar({
  role,
  size = 20,
  className,
  style,
}: {
  role: AgentRole;
  size?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const Glyph = AGENT_ROLE_GLYPHS[role];
  return <Glyph size={size} className={className} style={style} />;
}

/**
 * An enchanted audit scroll: a rolled parchment page with a verified
 * checkmark and a small arcane spark. Deliberately distinct from both the
 * main JusticeOS wizard mark (that glyph is the product's own identity,
 * not an agent's) and from a shield/coat-of-arms (explicitly ruled out by
 * the brand brief) -- flat geometric shapes only, no gradients or glow, so
 * it stays crisp at the ~20px size it renders at in the sidebar. The spark
 * sits top-right, well clear of the connection-status dot pinned to the
 * badge's bottom-right corner around it.
 */
function InsuranceAuditGlyph({ size, className, style }: GlyphProps): ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="img"
      aria-hidden="true"
      focusable="false"
      className={className}
      style={style}
    >
      <path d="M6 4.5C6 3.67 6.67 3 7.5 3h9c.83 0 1.5.67 1.5 1.5v15c0 .83-.67 1.5-1.5 1.5h-9A1.5 1.5 0 0 1 6 19.5v-15Z" fill="#FFF9ED" />
      <path d="M6 4.5C6 3.67 6.67 3 7.5 3h9c.83 0 1.5.67 1.5 1.5V6H6V4.5Z" fill="#6C43F3" />
      <path d="M9.25 12.6 11 14.35 14.75 10.6" stroke="#171B24" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <path d="m17.35 4.9.5 1.15 1.15.5-1.15.5-.5 1.15-.5-1.15-1.15-.5 1.15-.5Z" fill="#4FDCF7" />
    </svg>
  );
}

/**
 * A scrying orb on a stand: the Marketing Agent's work is looking outward
 * — reading the market, then deciding what to say about it — so it takes
 * the crystal orb from the same vocabulary the scroll came from. Flat
 * geometry only, like the scroll, so it stays legible at 20px beside the
 * rail's status dot.
 */
function MarketingGlyph({ size, className, style }: GlyphProps): ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden="true"
    >
      {/* The orb */}
      <circle cx="12" cy="9.5" r="5.5" />
      {/* A single highlight arc, so the circle reads as glass, not a dot */}
      <path d="M9.4 7.4a3.4 3.4 0 0 1 2.4-1.4" />
      {/* The stand */}
      <path d="M7.5 17h9l-1.2 3h-6.6z" />
      {/* An arcane spark, mirroring the audit scroll's */}
      <path d="M18.4 3.2v2.4M17.2 4.4h2.4" />
    </svg>
  );
}

const AGENT_ROLE_GLYPHS: Record<AgentRole, (props: GlyphProps) => ReactElement> = {
  'insurance-audit': InsuranceAuditGlyph,
  marketing: MarketingGlyph,
};
