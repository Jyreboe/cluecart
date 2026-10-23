import type React from "react";
export function Logo() {
  return (
    <span className="logo">
      <img src="/favicon.svg" alt="" />
      cluecart<span className="logo-dot">.</span>
    </span>
  );
}
export function Lamp({
  color,
  shape = "table",
}: {
  color: string;
  shape?: string;
}) {
  return (
    <div
      className={"lamp " + shape}
      style={{ "--lamp": color } as React.CSSProperties}
    >
      <div className="shade" />
      <div className="stem" />
      <div className="base" />
    </div>
  );
}
