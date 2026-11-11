// The app's mark «Стежок» (docs/brand/logo/LOGO.md): two cards on the canvas, the lead and the executor, and one thread
// from the lead under the executor. One colour (currentColor); the coloured version and the icon live in docs/brand/logo.
import { useId } from "react";

export function AppMark({ size = 16 }: { size?: number }): React.JSX.Element {
  const mask = useId();
  return (
    <svg className="app-mark" viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false">
      <defs>
        <mask id={mask} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
          <rect width="24" height="24" fill="#fff" />
          <rect x="12.1" y="11.6" width="10.3" height="10.3" rx="3.4" fill="#000" />
        </mask>
      </defs>
      <g fill="currentColor">
        <rect x="2.5" y="3" width="8.5" height="8.5" rx="2.5" />
        <rect x="13" y="12.5" width="8.5" height="8.5" rx="2.5" />
      </g>
      <path d="M12.1 7.25C13.6 7.25 11.6 16.75 13.75 16.75H22.75" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" mask={`url(#${mask})`} />
    </svg>
  );
}
