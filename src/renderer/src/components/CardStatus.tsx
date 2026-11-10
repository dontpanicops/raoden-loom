import { CARD_STATUS_ICON, type CardStatusKind } from "../lib/cardStatus";
import { UiIcon } from "./UiIcon";

// The status triple of a card: Lucide glyph + colour + label. The glyph is decoration; the label is the text a reader gets. live: announced on change (agent cards only).
export function CardStatus({ kind, label, live = false }: { kind: CardStatusKind; label: string; live?: boolean }): React.JSX.Element {
  return (
    <span className={`card-status card-status--${kind}`} data-card-status={kind} role={live ? "status" : undefined}>
      <UiIcon name={CARD_STATUS_ICON[kind]} size="1.15em" />
      <span>{label}</span>
    </span>
  );
}
