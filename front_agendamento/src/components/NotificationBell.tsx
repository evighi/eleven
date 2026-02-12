"use client";

import { Bell } from "lucide-react";
import type { RefObject } from "react";

type Props = {
  open: boolean;
  onToggle: () => void;
  anchorRef: RefObject<HTMLButtonElement | null>;
  countUnread: number;
};

export default function NotificationBell({ open, onToggle, anchorRef, countUnread }: Props) {
  return (
    <button
      ref={anchorRef}
      type="button"
      onClick={onToggle}
      aria-label="Notificações"
      className={[
        "relative inline-flex items-center justify-center",
        "h-10 w-10 rounded-full",
        "hover:bg-gray-100 transition",
        open ? "bg-gray-100" : "",
      ].join(" ")}
    >
      <Bell className="w-5 h-5 text-gray-700" />

      {countUnread > 0 && (
        <span
          className="
            absolute -top-1 -right-1
            min-w-[18px] h-[18px]
            px-1
            rounded-full
            bg-orange-600 text-white
            text-[11px] font-extrabold
            flex items-center justify-center
            shadow
          "
        >
          {countUnread > 99 ? "99+" : countUnread}
        </span>
      )}
    </button>
  );
}
