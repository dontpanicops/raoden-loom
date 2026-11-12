import type { ButtonHTMLAttributes, ReactNode } from "react";
import { UiIcon, type UiIconName } from "./UiIcon";

interface CanvasMenuRowProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  icon?: UiIconName;
  iconNode?: ReactNode;
  children: ReactNode;
  right?: ReactNode;
  muted?: boolean;
  danger?: boolean;
  indent?: boolean;
  selected?: boolean;
}

export function CanvasMenuRow({
  icon,
  iconNode,
  children,
  right,
  muted = false,
  danger = false,
  indent = false,
  selected = false,
  className,
  ...buttonProps
}: CanvasMenuRowProps): React.JSX.Element {
  return (
    <button
      {...buttonProps}
      className={[
        "canvas-menu__row",
        muted ? "canvas-menu__row--muted" : "",
        danger ? "canvas-menu__row--danger" : "",
        indent ? "canvas-menu__row--indent" : "",
        selected ? "canvas-menu__row--selected" : "",
        className ?? ""
      ].filter(Boolean).join(" ")}
      type={buttonProps.type ?? "button"}
    >
      {icon && <CanvasMenuIcon icon={icon} />}
      {iconNode && <span className="canvas-menu__icon">{iconNode}</span>}
      <span className="canvas-menu__grow">{children}</span>
      {right}
    </button>
  );
}

export function CanvasMenuIcon({ icon }: { icon: UiIconName }): React.JSX.Element {
  return (
    <span className="canvas-menu__icon">
      <UiIcon name={icon} size="1.23em" />
    </span>
  );
}

export function CanvasMenuDivider(): React.JSX.Element {
  return <div className="canvas-menu__divider" role="separator" />;
}

export function CanvasMenuLabel({ children }: { children: ReactNode }): React.JSX.Element {
  return <p className="canvas-menu__label">{children}</p>;
}

export function CanvasMenuKbd({ children }: { children: ReactNode }): React.JSX.Element {
  return <kbd className="canvas-menu__kbd">{children}</kbd>;
}

export function CanvasMenuSub({ children }: { children: ReactNode }): React.JSX.Element {
  return <span className="canvas-menu__sub">{children}</span>;
}

export function CanvasMenuChevron(): React.JSX.Element {
  return (
    <span className="canvas-menu__chevron">
      <UiIcon name="chevron" size="1em" />
    </span>
  );
}
