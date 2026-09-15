import type { CSSProperties, ReactElement } from 'react';

/**
 * Reusable wizard-themed role-icon system (JusticeOS gateway build): every
 * managed agent gets its own small, distinct glyph from this shared visual
 * vocabulary (an enchanted scroll here; a spellbook, crystal orb, potion
 * vessel, rune, key, or compass are the obvious next entries) instead of a
 * generic shield/coat-of-arms. Only 'insurance-audit' exists today -- the
 * brief is explicit that no other agent is created or displayed yet; adding
 * a role here is how a future agent gets its own icon, nothing else about
 * this component changes.
 */
export type AgentRole = 'insurance-audit';

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

const AGENT_ROLE_GLYPHS: Record<AgentRole, (props: GlyphProps) => ReactElement> = {
  'insurance-audit': InsuranceAuditGlyph,
};
