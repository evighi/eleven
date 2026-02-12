"use client";

import Link from "next/link";
import Image from "next/image";
import { Menu } from "lucide-react";
import { useRef, useState } from "react";
import { useAuthStore } from "@/context/AuthStore";
import AdminSideMenu from "@/components/AdminSideMenu";

import AdminNotificationsPopover from "@/components/AdminNotificationsPopover";
import NotificationBell from "@/components/NotificationBell";
import { useNotifications } from "@/hooks/useNotifications";

export default function AdminHeader() {
  const { usuario } = useAuthStore();

  const [openMenu, setOpenMenu] = useState(false);
  const menuBtnRef = useRef<HTMLButtonElement | null>(null);

  const [openNotif, setOpenNotif] = useState(false);
  const notifBtnRef = useRef<HTMLButtonElement | null>(null);

  // ✅ um único estado de notificações para tudo
  const notif = useNotifications();

  if (!usuario) return null;

  return (
    <>
      <AdminNotificationsPopover
        open={openNotif}
        onClose={() => setOpenNotif(false)}
        anchorRef={notifBtnRef}
        loading={notif.loading}
        items={notif.items}
        fetchNotifications={notif.fetchNotifications}
        markVisibleRead={notif.markVisibleRead}
      />

      <AdminSideMenu open={openMenu} onClose={() => setOpenMenu(false)} anchorRef={menuBtnRef} />

      <div className="bg-white">
        <div className="max-w-6xl mx-auto border-b border-gray-300">
          <header data-admin-header-container className="px-4 py-3 flex items-center justify-between">
            <Link href="/adminMaster" className="flex items-center">
              <Image
                src="/logoelevenhor.png"
                alt="Logo da Eleven"
                width={160}
                height={48}
                priority
                className="w-auto h-10"
              />
            </Link>

            <div className="flex items-center gap-2">
              <NotificationBell
                open={openNotif}
                anchorRef={notifBtnRef}
                countUnread={notif.countUnread}
                onToggle={() => {
                  setOpenMenu(false);

                  if (openNotif) {
                    // ✅ fecha na hora
                    setOpenNotif(false);

                    // ✅ marca lidas "em background" (não bloqueia UI)
                    void notif.markVisibleRead();
                    return;
                  }

                  setOpenNotif(true);
                }}
              />

              <button
                ref={menuBtnRef}
                onClick={() => {
                  if (openNotif) {
                    setOpenNotif(false);
                    void notif.markVisibleRead();
                  }
                  setOpenMenu((v) => !v);
                }}
                className="p-2 rounded-md text-gray-700 hover:text-gray-900 hover:bg-gray-100 transition cursor-pointer"
                aria-label="Abrir menu"
              >
                <Menu size={34} />
              </button>
            </div>
          </header>
        </div>
      </div>
    </>
  );
}
