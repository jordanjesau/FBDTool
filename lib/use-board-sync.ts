"use client";

import { createClient } from "@supabase/supabase-js";
import { useEffect, useRef, useState } from "react";
import { BoardDocument, isBoardDocument, mergeBoardDocuments } from "./board-document";

export type BoardSyncStatus = "local" | "connecting" | "connected" | "error";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
export const boardSyncConfigured = Boolean(supabaseUrl && supabaseAnonKey);

function loadBoard(roomId: string): BoardDocument | null {
  try {
    const stored = window.localStorage.getItem(`fbd-board-${roomId}`);
    if (!stored) return null;
    const parsed: unknown = JSON.parse(stored);
    return isBoardDocument(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function saveBoard(roomId: string, document: BoardDocument) {
  try {
    window.localStorage.setItem(`fbd-board-${roomId}`, JSON.stringify(document));
  } catch {
    // Live sync remains available if this device's storage is full or disabled.
  }
}

export function readStoredBoard(roomId: string): BoardDocument | null {
  return loadBoard(roomId);
}

export function useBoardSync(
  roomId: string | null,
  clientId: string,
  document: BoardDocument,
  setDocument: (update: (current: BoardDocument) => BoardDocument) => void,
) {
  const [status, setStatus] = useState<BoardSyncStatus>("local");
  const [error, setError] = useState("");
  const [deviceCount, setDeviceCount] = useState(0);
  const documentRef = useRef(document);
  const sendRef = useRef<(event: string, payload: Record<string, unknown>) => void>(() => {});
  const lastSentRef = useRef("");
  documentRef.current = document;

  useEffect(() => {
    if (!roomId) {
      setStatus("local");
      setError("");
      setDeviceCount(0);
      sendRef.current = () => {};
      lastSentRef.current = "";
      return;
    }
    setDeviceCount(0);
    if (!boardSyncConfigured || !supabaseUrl || !supabaseAnonKey) {
      setStatus("error");
      setError("Live sync is not configured on this deployment. Set the two Supabase environment variables to enable it.");
      setDeviceCount(0);
      return;
    }

    setStatus("connecting");
    setError("");
    const client = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const channel = client.channel(`board-${roomId}`, {
      config: { broadcast: { ack: true, self: false }, presence: { key: clientId } },
    });
    const send = (event: string, payload: Record<string, unknown>) => {
      if (new TextEncoder().encode(JSON.stringify(payload)).length > 180_000) {
        setError("This board is too large to send in one sync update. Clear old sketch strokes or shorten the equations, then try again.");
        return;
      }
      void channel.send({ type: "broadcast", event, payload }).then((result) => {
        if (result !== "ok") {
          setError("The sync service did not accept the latest update. Check your connection and sharing setup.");
        } else {
          setError("");
        }
      }).catch(() => {
        setError("Could not send the board update. Check your internet connection.");
      });
    };
    sendRef.current = send;

    channel
      .on("presence", { event: "sync" }, () => {
        setDeviceCount(Object.keys(channel.presenceState()).length);
      })
      .on("broadcast", { event: "sync-request" }, ({ payload }) => {
        if (payload?.clientId === clientId) return;
        send("board-state", { clientId, document: documentRef.current });
      })
      .on("broadcast", { event: "board-state" }, ({ payload }) => {
        if (payload?.clientId === clientId || !isBoardDocument(payload?.document)) return;
        const remote = payload.document;
        setDocument((current) => {
          const merged = mergeBoardDocuments(current, remote);
          return JSON.stringify(merged) === JSON.stringify(current) ? current : merged;
        });
      })
      .subscribe((subscriptionStatus) => {
        if (subscriptionStatus === "SUBSCRIBED") {
          setStatus("connected");
          setError("");
          void channel.track({}).then((result) => {
            if (result !== "ok") setError("Sync is connected, but the number of connected devices may be unavailable.");
          }).catch(() => setError("Sync is connected, but the number of connected devices may be unavailable."));
          send("sync-request", { clientId });
          send("board-state", { clientId, document: documentRef.current });
        } else if (subscriptionStatus === "CHANNEL_ERROR" || subscriptionStatus === "TIMED_OUT") {
          setStatus("error");
          setDeviceCount(0);
          setError("Could not connect to the shared board. Check the Supabase URL, key, and internet connection.");
        } else if (subscriptionStatus === "CLOSED") {
          setStatus("error");
          setDeviceCount(0);
          setError("The shared board connection closed. Reopen the share link to reconnect.");
        }
      });

    return () => {
      sendRef.current = () => {};
      void client.removeChannel(channel);
    };
  }, [clientId, roomId, setDocument]);

  useEffect(() => {
    if (!roomId) return;
    const timeout = window.setTimeout(() => saveBoard(roomId, document), 120);
    return () => window.clearTimeout(timeout);
  }, [document, roomId]);

  useEffect(() => {
    if (!roomId || status !== "connected") return;
    const serialized = JSON.stringify(document);
    if (serialized === lastSentRef.current) return;
    lastSentRef.current = serialized;
    sendRef.current("board-state", { clientId, document });
  }, [clientId, document, roomId, status]);

  return { status, error, deviceCount };
}
