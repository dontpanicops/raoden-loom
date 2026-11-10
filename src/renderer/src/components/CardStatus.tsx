import { CARD_STATUS_ICON, type CardStatusKind } from "../lib/cardStatus";
import { UiIcon } from "./UiIcon";

// The status triple of a card: Lucide glyph + colour + label. The glyph is decoration; the label is the text a reader gets.
export function CardStatus({ kind, label, title }: { kind: CardStatusKind; label: string; title?: string }): React.JSX.Element {
  return (
    <span className={`card-status card-status--${kind}`} data-card-status={kind} role="status" title={title ?? label}>
      <UiIcon name={CARD_STATUS_ICON[kind]} size="1.15em" />
      <span>{label}</span>
    </span>
  );
}
