// utils/notificationHub.ts
import type { Response } from "express";

type Client = {
  res: Response;
  userId: string;
  createdAt: number;
};

function sseWrite(res: Response, event: string, data: any) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

class NotificationHub {
  // userId -> set de conexões SSE
  private clientsByUser = new Map<string, Set<Client>>();

  addClient(userId: string, res: Response) {
    const client: Client = { res, userId, createdAt: Date.now() };

    if (!this.clientsByUser.has(userId)) {
      this.clientsByUser.set(userId, new Set());
    }
    this.clientsByUser.get(userId)!.add(client);

    // manda um hello inicial (opcional)
    sseWrite(res, "hello", { ok: true, ts: Date.now() });

    return () => this.removeClient(client);
  }

  removeClient(client: Client) {
    const set = this.clientsByUser.get(client.userId);
    if (!set) return;

    set.delete(client);
    if (set.size === 0) this.clientsByUser.delete(client.userId);
  }

  emitToUsers(userIds: string[], payload: any) {
    const uniq = Array.from(new Set(userIds));
    for (const uid of uniq) {
      const set = this.clientsByUser.get(uid);
      if (!set || set.size === 0) continue;

      for (const c of set) {
        try {
          sseWrite(c.res, "notification", payload);
        } catch {
          // se der erro ao escrever, remove
          this.removeClient(c);
        }
      }
    }
  }

  // keep-alive pra não cair em proxy
  pingAll() {
    for (const [, set] of this.clientsByUser) {
      for (const c of set) {
        try {
          sseWrite(c.res, "ping", { ts: Date.now() });
        } catch {
          this.removeClient(c);
        }
      }
    }
  }
}

export const notificationHub = new NotificationHub();
