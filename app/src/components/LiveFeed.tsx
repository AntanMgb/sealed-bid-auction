"use client";

import { FC, useEffect, useRef } from "react";
import { formatDistanceToNow } from "date-fns";
import { AuctionEvent } from "@/lib/magicblock";

interface Props {
  events: AuctionEvent[];
}

const EVENT_ICONS: Record<AuctionEvent["type"], string> = {
  bid_placed: "🔒",
  auction_closed: "✅",
  auction_settled: "🏆",
  bid_count: "📊",
};

const EVENT_BORDER_COLORS: Record<AuctionEvent["type"], string> = {
  bid_placed: "rgba(136,51,255,0.6)",
  auction_closed: "rgba(74,222,128,0.6)",
  auction_settled: "rgba(204,51,255,0.6)",
  bid_count: "rgba(51,85,255,0.6)",
};

const EVENT_BG_COLORS: Record<AuctionEvent["type"], string> = {
  bid_placed: "rgba(136,51,255,0.06)",
  auction_closed: "rgba(74,222,128,0.06)",
  auction_settled: "rgba(204,51,255,0.06)",
  bid_count: "rgba(51,85,255,0.06)",
};

export const LiveFeed: FC<Props> = ({ events }) => {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events]);

  return (
    <div className="card overflow-hidden">
      {/* Header */}
      <div
        className="flex items-center justify-between px-5 py-3"
        style={{ borderBottom: "1px solid var(--border)", background: "var(--surface-hover)" }}
      >
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: "var(--accent-violet)" }} />
            <span className="relative inline-flex rounded-full h-2 w-2" style={{ background: "var(--accent-violet)" }} />
          </span>
          <span className="text-sm font-semibold text-white">
            Live Transaction Feed
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-[10px]" style={{ color: "var(--text-dim)" }}>
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--accent-violet)" }} />
          via Private Ephemeral Rollup
        </div>
      </div>

      {/* Feed */}
      <div className="h-72 overflow-y-auto p-4 space-y-2 mono text-xs">
        {events.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2" style={{ color: "var(--text-dim)" }}>
            <span className="text-2xl">⛓️</span>
            <span>Waiting for events from the TEE...</span>
          </div>
        ) : (
          events.map((event, i) => (
            <div
              key={i}
              className="pl-3 pr-3 py-2.5 rounded-lg"
              style={{
                borderLeft: `2px solid ${EVENT_BORDER_COLORS[event.type]}`,
                background: EVENT_BG_COLORS[event.type],
              }}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-base shrink-0">
                    {EVENT_ICONS[event.type]}
                  </span>
                  <div className="min-w-0">
                    <div className="text-white truncate">
                      {String(event.data.message ?? event.type)}
                    </div>
                    {event.type === "bid_placed" && (
                      <div className="text-[10px] mt-0.5" style={{ color: "var(--text-dim)" }}>
                        bid #{event.data.bidCount as number} •{" "}
                        <span style={{ color: "var(--accent-violet)" }}>
                          amount sealed in TEE
                        </span>
                      </div>
                    )}
                    {event.type === "auction_closed" && (
                      event.data.winner ? (
                        <div className="text-[10px] mt-0.5" style={{ color: "#4ade80" }}>
                          winner:{" "}
                          {String(event.data.winner).slice(0, 8)}...
                          {"  "}•{"  "}
                          {(Number(event.data.winningBid) / 1e9).toFixed(4)} SOL
                        </div>
                      ) : (
                        <div className="text-[10px] mt-0.5" style={{ color: "var(--text-dim)" }}>
                          no valid bids above reserve price
                        </div>
                      )
                    )}
                    {!!event.data.slot && (
                      <div className="text-[10px]" style={{ color: "var(--text-dim)" }}>
                        slot {String(event.data.slot)}
                      </div>
                    )}
                  </div>
                </div>
                <span className="shrink-0" style={{ color: "var(--text-dim)" }}>
                  {formatDistanceToNow(event.timestamp, { addSuffix: true })}
                </span>
              </div>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {/* Footer */}
      <div className="px-5 py-2.5" style={{ borderTop: "1px solid var(--border)", background: "var(--surface-hover)" }}>
        <p className="text-[10px]" style={{ color: "var(--text-dim)" }}>
          Bid amounts are sealed inside the TEE (Intel TDX). Only existence of
          bids is public. Winner is computed by the enclave and committed to L1.
        </p>
      </div>
    </div>
  );
};
