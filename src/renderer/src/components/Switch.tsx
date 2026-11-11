// Boolean setting: a native button, so Space and Enter toggle it; the state is read from aria-checked.
export function Switch({
  checked,
  label,
  disabled,
  onChange,
  ...rest
}: {
  checked: boolean;
  label: string;
  disabled?: boolean;
  onChange(checked: boolean): void;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onChange" | "role" | "aria-checked" | "aria-label" | "type">): React.JSX.Element {
  return (
    <button
      {...rest}
      className={`switch${checked ? " switch--on" : ""}`}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    ><span className="switch__thumb" aria-hidden="true" /></button>
  );
}
